/**
 * Data Preprocessor for Digital DNA
 * 
 * This Lambda function preprocesses uploaded files by:
 * 1. Converting PDFs to text
 * 2. Chunking large files into smaller parts with overlap
 * 
 * Environment Variables:
 * - S3_BUCKET_NAME: The name of the S3 bucket for user data
 */

// Include dependencies
const AWS = require("aws-sdk");
const https = require("https");
const path = require("path");
const pdfParse = require('pdf-parse');

// Initialize AWS clients
const s3 = new AWS.S3();
const lambda = new AWS.Lambda();

// Constants
const MAX_CHUNK_SIZE = 20 * 1024; // 20 KB
const CHUNK_OVERLAP = 2 * 1024; // 2 KB overlap

/**
 * Main Lambda handler function
 */
exports.handler = async (event) => {
  try {
    console.log("Preprocessor received event:", JSON.stringify(event));

    // Process each record (could be multiple S3 uploads)
    for (const record of event.Records || []) {
      // Process S3 event
      if (record.s3) {
        await processS3Event(record);
      } else {
        console.log("Unknown event type, skipping", record);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Preprocessing completed successfully" }),
    };
  } catch (error) {
    console.error("Error in preprocessor Lambda:", error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Error in preprocessing process",
        error: {
          message: error.message,
          code: error.code,
          statusCode: error.statusCode,
        },
      }),
    };
  }
};

/**
 * Process an S3 event record
 * @param {Object} record - The S3 event record
 */
async function processS3Event(record) {
  const bucket = record.s3.bucket.name;
  // Decode URI components and replace '+' with spaces
  const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
  
  console.log(`Processing S3 event: Bucket=${bucket}, Key=${key}`);
  
  // Parse the S3 key to extract user email and stage
  const pathParts = key.split('/');
  
  // Validate path has at least user/stage format
  if (pathParts.length < 2) {
    console.error(`Invalid path format: ${key}`);
    throw new Error("Invalid path format. Expected: <userEmail>/<stage>/...");
  }
  
  const userEmail = pathParts[0];
  const stage = pathParts[1];
  
  console.log(`User: ${userEmail}, Stage: ${stage}`);
  
  // Skip processing temporary files or non-data files
  if (key.includes('.tmp') || key.includes('_$folder$') || key.endsWith('/')) {
    console.log(`Skipping non-data file: ${key}`);
    return;
  }
  
  // Only process files from stage1
  if (stage === 'stage1') {
    await preprocessFile(bucket, key, userEmail);
  } else {
    console.log(`Skipping file not in stage1: ${key}`);
  }
}

/**
 * Preprocess the file based on its type
 * @param {string} bucket - S3 bucket name
 * @param {string} key - S3 object key
 * @param {string} userEmail - User's email
 */
async function preprocessFile(bucket, key, userEmail) {
  const fileName = key.split('/').pop();
  const fileExtension = path.extname(fileName).toLowerCase();
  
  console.log(`Preprocessing file: ${fileName} with extension ${fileExtension}`);
  
  // Get the content of the file
  const fileContent = await getFileContent(bucket, key);
  
  // Process based on file type
  if (fileExtension === '.pdf') {
    // Convert PDF to text
    const textContent = await convertPdfToText(fileContent);
    
    // Store the converted text file
    const textFileName = fileName.replace('.pdf', '.txt');
    const textKey = `${userEmail}/preprocessed/${textFileName}`;
    
    await storeProcessedFile(bucket, textKey, textContent);
    
    // Chunk the text file if needed
    await chunkFileIfNeeded(bucket, textKey, userEmail, textContent);
  } else {
    // For non-PDF files, just chunk if needed
    await chunkFileIfNeeded(bucket, key, userEmail, fileContent);
  }
  
  // Trigger next stage processing
  await triggerCategorizer(bucket, userEmail, fileName);
}

/**
 * Get file content from S3
 * @param {string} bucket - S3 bucket name
 * @param {string} key - S3 object key
 * @returns {Promise<string|Buffer>} - File content
 */
async function getFileContent(bucket, key) {
  try {
    const params = {
      Bucket: bucket,
      Key: key
    };
    
    const data = await s3.getObject(params).promise();
    
    // For text files, convert to string
    const contentType = data.ContentType || '';
    if (contentType.includes('text') || key.endsWith('.txt') || key.endsWith('.json')) {
      return data.Body.toString('utf-8');
    }
    
    // Return binary data for other files
    return data.Body;
  } catch (error) {
    console.error(`Error getting file from S3: ${bucket}/${key}`, error);
    throw error;
  }
}

/**
 * Attempts to detect and restructure tables in PDF text output
 * @param {string} text - The extracted text from PDF
 * @returns {string} - Text with improved table formatting
 */
function detectAndFormatTables(text) {
  try {
    console.log("Attempting to detect and format tables in PDF text");
    
    // Split text into lines
    const lines = text.split('\n');
    let result = [];
    let inTable = false;
    let tableLines = [];
    let consecutiveSpacedLines = 0;
    
    // Regular expressions for table detection
    const tableHeaderPattern = /\s{2,}|\t{1,}/; // Multiple spaces or tabs separating columns
    const consistentSpacingPattern = /^[^\s]+(\s{2,}[^\s]+){2,}$/; // Line with consistent pattern of text separated by spaces
    
    // Process each line
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();
      
      // Skip empty lines
      if (!trimmedLine) {
        // If we're in a table and hit an empty line, it might be the end of the table
        if (inTable) {
          consecutiveSpacedLines = 0;
          
          // Add a small margin before ending the table detection
          if (i + 1 < lines.length && !lines[i + 1].trim()) {
            // Two consecutive empty lines - end table detection
            inTable = false;
            
            // Process the detected table
            if (tableLines.length > 2) { // Need at least 3 lines for a valid table
              const formattedTable = formatTableLines(tableLines);
              result.push(formattedTable);
              tableLines = [];
            } else {
              // Not enough lines for a table, just add them back
              result = result.concat(tableLines);
              tableLines = [];
            }
          } else {
            // Single empty line might be within the table
            tableLines.push(line);
          }
        } else {
          // Not in a table, just add the empty line
          result.push(line);
        }
        continue;
      }
      
      // Detect potential table starts by looking for consistent spacing or tab characters
      const hasTablePatterns = tableHeaderPattern.test(trimmedLine);
      const hasConsistentSpacing = consistentSpacingPattern.test(trimmedLine);
      
      if (hasTablePatterns || hasConsistentSpacing) {
        if (!inTable) {
          // This might be the start of a table
          consecutiveSpacedLines++;
          
          if (consecutiveSpacedLines >= 2) {
            // We found what appears to be a table
            inTable = true;
            // Add the previous line that we now know is part of the table
            if (i >= consecutiveSpacedLines) {
              for (let j = i - consecutiveSpacedLines + 1; j <= i; j++) {
                tableLines.push(lines[j]);
              }
            } else {
              tableLines.push(line);
            }
          } else {
            // Not enough evidence for a table yet
            result.push(line);
          }
        } else {
          // Already in a table, continue collecting table lines
          tableLines.push(line);
        }
      } else {
        // This line doesn't match table patterns
        if (inTable) {
          // Check if we should end table detection
          const wordsInLine = trimmedLine.split(/\s+/).length;
          
          if (wordsInLine <= 2 || trimmedLine.length < 10) {
            // Short line might still be part of table (like a title or footnote)
            tableLines.push(line);
          } else {
            // Longer line without table patterns - end table detection
            inTable = false;
            
            // Process the detected table
            if (tableLines.length > 2) {
              const formattedTable = formatTableLines(tableLines);
              result.push(formattedTable);
            } else {
              // Not enough lines for a table, just add them back
              result = result.concat(tableLines);
            }
            tableLines = [];
            result.push(line);
          }
        } else {
          // Not in a table
          consecutiveSpacedLines = 0;
          result.push(line);
        }
      }
    }
    
    // Handle any remaining table lines
    if (tableLines.length > 0) {
      if (tableLines.length > 2) {
        const formattedTable = formatTableLines(tableLines);
        result.push(formattedTable);
      } else {
        result = result.concat(tableLines);
      }
    }
    
    return result.join('\n');
  } catch (error) {
    console.error("Error formatting tables:", error);
    return text; // Return original text if anything goes wrong
  }
}

/**
 * Format detected table lines for better readability
 * @param {string[]} tableLines - Lines that appear to form a table
 * @returns {string} - Formatted table
 */
function formatTableLines(tableLines) {
  try {
    // Add table markdown markers
    let result = '\n```\n';
    
    // Try to detect column positions by examining the first few non-empty lines
    let columnPositions = [];
    let headerLine = null;
    
    // Find a good header line with clear column separations
    for (let i = 0; i < Math.min(tableLines.length, 5); i++) {
      const line = tableLines[i].trim();
      if (line && line.length > 10) {
        // Look for multiple spaces or tabs as column separators
        const separators = [...line.matchAll(/\s{2,}|\t+/g)];
        if (separators.length >= 2) {
          headerLine = i;
          for (const match of separators) {
            columnPositions.push(match.index);
          }
          break;
        }
      }
    }
    
    // If we couldn't detect column positions, just return the lines with minimal formatting
    if (columnPositions.length === 0) {
      result += tableLines.join('\n');
      result += '\n```\n';
      return result;
    }
    
    // Extract and align columns for each line
    for (let i = 0; i < tableLines.length; i++) {
      let line = tableLines[i].trim();
      if (!line) {
        result += '\n';
        continue;
      }
      
      // Add separator line after header
      if (i === headerLine + 1) {
        let separatorLine = '';
        let lastEnd = 0;
        
        // Create separator based on the header columns
        for (let j = 0; j <= columnPositions.length; j++) {
          const start = j === 0 ? 0 : columnPositions[j - 1];
          const end = j === columnPositions.length ? line.length : columnPositions[j];
          const width = end - start;
          
          separatorLine += '-'.repeat(Math.max(3, width)) + (j < columnPositions.length ? '  ' : '');
        }
        
        result += separatorLine + '\n';
      }
      
      // Format this line with consistent column spacing
      let formattedLine = '';
      let lastEnd = 0;
      
      // Split the line into columns based on detected positions
      for (let j = 0; j <= columnPositions.length; j++) {
        const start = j === 0 ? 0 : columnPositions[j - 1];
        const end = j === columnPositions.length ? line.length : columnPositions[j];
        
        // Extract column content
        let columnContent = '';
        if (j === 0) {
          columnContent = line.substring(0, end).trim();
        } else if (j === columnPositions.length) {
          columnContent = line.substring(start).trim();
        } else {
          columnContent = line.substring(start, end).trim();
        }
        
        // Add to formatted line with consistent spacing
        formattedLine += columnContent + (j < columnPositions.length ? '  ' : '');
      }
      
      result += formattedLine + '\n';
    }
    
    result += '```\n';
    return result;
  } catch (error) {
    console.error("Error formatting table lines:", error);
    return tableLines.join('\n'); // Return original lines if formatting fails
  }
}

/**
 * Attempts to extract form fields from a PDF document
 * This is a basic implementation that looks for common form field patterns
 * @param {string} text - The extracted text from the PDF
 * @returns {Object|null} - Extracted form fields or null if none found
 */
function extractPdfFormFields(text) {
  try {
    console.log("Attempting to extract form fields from PDF");
    
    // Initialize form fields object
    const formFields = {};
    
    // Common patterns for form fields
    const patterns = [
      // Name pattern (First Name: [value], Last Name: [value])
      { regex: /First\s*Name\s*:?\s*([^\n\r:;]*)/i, key: 'firstName' },
      { regex: /Last\s*Name\s*:?\s*([^\n\r:;]*)/i, key: 'lastName' },
      { regex: /Full\s*Name\s*:?\s*([^\n\r:;]*)/i, key: 'fullName' },
      
      // Contact information
      { regex: /Email\s*:?\s*([^\s][\w.%+-]+@[\w.-]+\.[a-zA-Z]{2,})/i, key: 'email' },
      { regex: /Phone\s*:?\s*([\+]?\d{1,3}[-\s\.]?\(?\d{3}\)?[-\s\.]?\d{3}[-\s\.]?\d{4})/i, key: 'phone' },
      
      // Address fields
      { regex: /Address\s*:?\s*([^\n\r:;]*)/i, key: 'address' },
      { regex: /City\s*:?\s*([^\n\r:;]*)/i, key: 'city' },
      { regex: /State\s*:?\s*([^\n\r:;]*)/i, key: 'state' },
      { regex: /Zip\s*:?\s*(\d{5}(?:-\d{4})?)/i, key: 'zip' },
      { regex: /Country\s*:?\s*([^\n\r:;]*)/i, key: 'country' },
      
      // Date fields
      { regex: /Date\s*of\s*Birth\s*:?\s*(\d{1,2}[-\/\s\.]\d{1,2}[-\/\s\.]\d{2,4})/i, key: 'dateOfBirth' },
      { regex: /Date\s*:?\s*(\d{1,2}[-\/\s\.]\d{1,2}[-\/\s\.]\d{2,4})/i, key: 'date' },
      
      // Identification numbers
      { regex: /SSN\s*:?\s*(\d{3}-\d{2}-\d{4})/i, key: 'ssn' },
      { regex: /Driver'?s?\s*License\s*:?\s*([A-Z0-9-]*)/i, key: 'driversLicense' },
      { regex: /Passport\s*:?\s*([A-Z0-9]*)/i, key: 'passport' },
      
      // Financial information
      { regex: /Account\s*Number\s*:?\s*([A-Z0-9-]*)/i, key: 'accountNumber' },
      { regex: /Credit\s*Card\s*:?\s*(\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4})/i, key: 'creditCard' },
      
      // Common CCPA/GDPR specific fields
      { regex: /Request\s*Type\s*:?\s*([^\n\r:;]*)/i, key: 'requestType' },
      { regex: /Data\s*Request\s*:?\s*([^\n\r:;]*)/i, key: 'dataRequest' }
    ];
    
    // Extract fields using the patterns
    for (const pattern of patterns) {
      const match = text.match(pattern.regex);
      if (match && match[1] && match[1].trim()) {
        formFields[pattern.key] = match[1].trim();
      }
    }
    
    // Check if we found any fields
    if (Object.keys(formFields).length === 0) {
      console.log("No form fields detected in PDF");
      return null;
    }
    
    console.log(`Extracted ${Object.keys(formFields).length} form fields from PDF`);
    return formFields;
  } catch (error) {
    console.error("Error extracting form fields:", error);
    return null;
  }
}

/**
 * Convert PDF file to text
 * @param {Buffer} pdfContent - PDF file content
 * @returns {Promise<string>} - Extracted text
 */
async function convertPdfToText(pdfContent) {
  console.log("Converting PDF to text using pdf-parse");
  
  try {
    // Options for pdf-parse
    const options = {
      // Limit the max number of pages to parse (0 = no limit)
      max: 0,
      
      // Enable PDF version detection
      version: true,
      
      // Extract text in reading order
      pagerender: function(pageData) {
        return pageData.getTextContent()
          .then(function(textContent) {
            let lastY, text = '';
            const items = textContent.items;
            
            // Sort items by y-position first for better reading order
            items.sort(function(a, b) {
              if (a.transform[5] !== b.transform[5]) {
                return b.transform[5] - a.transform[5];
              }
              return a.transform[4] - b.transform[4];
            });
            
            // Now extract text in reading order
            for (let i = 0; i < items.length; i++) {
              const item = items[i];
              
              // Add newline if we move to a new line
              if (lastY !== item.transform[5]) {
                if (lastY !== undefined) {
                  text += '\n';
                }
                lastY = item.transform[5];
              }
              
              // Append text of the item
              text += item.str;
            }
            
            return text;
          });
      }
    };
    
    // Parse the PDF
    const data = await pdfParse(pdfContent, options);
    
    // Try to extract form fields from the PDF
    const formFields = extractPdfFormFields(data.text);
    
    // Extract metadata about the PDF
    const metadata = {
      text: data.text,
      info: {
        pages: data.numpages,
        version: data.pdfinfo?.version || 'unknown',
        metadata: data.metadata || {},
        encrypted: !!data.pdfinfo?.encrypted,
        formFields: formFields || {}
      }
    };
    
    console.log(`Successfully extracted ${data.text.length} characters from ${data.numpages} page PDF`);
    
    // Add metadata as JSON comment at the beginning of the text
    const metadataJson = JSON.stringify(metadata.info, null, 2);
    const metadataComment = `/*\nPDF Metadata:\n${metadataJson}\n*/\n\n`;
    
    // If form fields were found, add them as structured data at the beginning
    let structuredDataSection = '';
    if (formFields && Object.keys(formFields).length > 0) {
      structuredDataSection = "--- FORM FIELDS ---\n";
      
      // Add each field as key: value
      for (const [key, value] of Object.entries(formFields)) {
        // Format the key with proper capitalization and spacing
        const formattedKey = key
          .replace(/([A-Z])/g, ' $1')  // Add space before capital letters
          .replace(/^./, str => str.toUpperCase()); // Capitalize first letter
          
        structuredDataSection += `${formattedKey}: ${value}\n`;
      }
      
      structuredDataSection += "-------------------\n\n";
    }
    
    // Try to detect and format tables in the text
    const textWithFormattedTables = detectAndFormatTables(data.text);
    
    // Return the text with metadata, form fields, and formatted tables
    return metadataComment + structuredDataSection + textWithFormattedTables;
  } catch (error) {
    console.error("Error parsing PDF:", error);
    
    // Fall back to a simple extraction method if pdf-parse fails
    try {
      const basicData = await pdfParse(pdfContent);
      console.log("Falling back to basic PDF text extraction");
      
      // Try to extract form fields from the basic extraction
      const formFields = extractPdfFormFields(basicData.text);
      
      // Add form fields section if any were found
      let output = "";
      if (formFields && Object.keys(formFields).length > 0) {
        output += "--- FORM FIELDS ---\n";
        
        for (const [key, value] of Object.entries(formFields)) {
          const formattedKey = key
            .replace(/([A-Z])/g, ' $1')
            .replace(/^./, str => str.toUpperCase());
            
          output += `${formattedKey}: ${value}\n`;
        }
        
        output += "-------------------\n\n";
      }
      
      // Try to detect and format tables even in fallback mode
      const textWithFormattedTables = detectAndFormatTables(basicData.text);
      
      return output + textWithFormattedTables;
    } catch (fallbackError) {
      console.error("Fallback PDF extraction failed:", fallbackError);
      throw new Error(`Failed to extract text from PDF: ${error.message}`);
    }
  }
}

/**
 * Chunk a file into smaller pieces if it exceeds the max chunk size
 * @param {string} bucket - S3 bucket name
 * @param {string} key - S3 object key
 * @param {string} userEmail - User's email
 * @param {string|Buffer} content - File content
 */
async function chunkFileIfNeeded(bucket, key, userEmail, content) {
  // Convert binary content to string if needed
  const textContent = content instanceof Buffer ? content.toString('utf-8') : content;
  
  // Get file info
  const fileName = key.split('/').pop();
  const baseFileName = path.basename(fileName, path.extname(fileName));
  
  // Check if file needs chunking
  if (textContent.length <= MAX_CHUNK_SIZE) {
    console.log(`File size (${textContent.length} bytes) is under the chunking threshold`);
    
    // If the file is not already in preprocessed folder, copy it there
    if (!key.includes('/preprocessed/')) {
      const preprocessedKey = `${userEmail}/preprocessed/${fileName}`;
      await storeProcessedFile(bucket, preprocessedKey, textContent);
    }
    
    return;
  }
  
  console.log(`Chunking file: ${fileName} (${textContent.length} bytes)`);
  
  // Chunk the file
  let position = 0;
  let chunkIndex = 0;
  
  while (position < textContent.length) {
    // Calculate end position of this chunk
    const endPosition = Math.min(position + MAX_CHUNK_SIZE, textContent.length);
    
    // Extract chunk with overlap
    let chunk;
    if (position > 0) {
      // Include overlap from previous chunk
      const startWithOverlap = Math.max(0, position - CHUNK_OVERLAP);
      chunk = textContent.substring(startWithOverlap, endPosition);
    } else {
      chunk = textContent.substring(position, endPosition);
    }
    
    // Create chunk filename
    const chunkFileName = `${baseFileName}_chunk${chunkIndex.toString().padStart(3, '0')}${path.extname(fileName)}`;
    const chunkKey = `${userEmail}/preprocessed/${chunkFileName}`;
    
    // Store the chunk
    await storeProcessedFile(bucket, chunkKey, chunk);
    
    // Move to next chunk position
    position = endPosition;
    chunkIndex++;
  }
  
  console.log(`Created ${chunkIndex} chunks from ${fileName}`);
}

/**
 * Store a processed file in S3
 * @param {string} bucket - S3 bucket name
 * @param {string} key - S3 object key
 * @param {string|Buffer} content - File content
 */
async function storeProcessedFile(bucket, key, content) {
  try {
    const params = {
      Bucket: bucket,
      Key: key,
      Body: content,
      ContentType: key.endsWith('.json') ? 'application/json' : 'text/plain'
    };
    
    await s3.putObject(params).promise();
    console.log(`Stored processed file: ${bucket}/${key}`);
  } catch (error) {
    console.error(`Error storing processed file: ${bucket}/${key}`, error);
    throw error;
  }
}

/**
 * Trigger the categorization Lambda for preprocessed files
 * @param {string} bucket - S3 bucket name
 * @param {string} userEmail - User's email
 * @param {string} originalFileName - Original file name
 */
async function triggerCategorizer(bucket, userEmail, originalFileName) {
  console.log(`Triggering categorization for preprocessed files derived from ${originalFileName}`);
  
  // List all preprocessed files related to this original file
  const baseFileName = path.basename(originalFileName, path.extname(originalFileName));
  const prefix = `${userEmail}/preprocessed/${baseFileName}`;
  
  const params = {
    Bucket: bucket,
    Prefix: prefix
  };
  
  try {
    const response = await s3.listObjectsV2(params).promise();
    const files = response.Contents || [];
    
    console.log(`Found ${files.length} preprocessed files to categorize`);
    
    // Invoke categorization Lambda for each preprocessed file
    for (const file of files) {
      const categorizeParams = {
        FunctionName: 'categorize-user-data',
        InvocationType: 'Event', // Asynchronous invocation
        Payload: JSON.stringify({
          Records: [{
            s3: {
              bucket: { name: bucket },
              object: { key: file.Key }
            }
          }]
        })
      };
      
      await lambda.invoke(categorizeParams).promise();
      console.log(`Triggered categorization for ${file.Key}`);
    }
  } catch (error) {
    console.error(`Error triggering categorization: ${error}`);
    throw error;
  }
}