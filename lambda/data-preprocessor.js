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
 * Convert PDF file to text
 * @param {Buffer} pdfContent - PDF file content
 * @returns {Promise<string>} - Extracted text
 */
async function convertPdfToText(pdfContent) {
  // Note: In a real implementation, you would use a PDF parsing library or service
  // For this example, we'll simulate PDF extraction with a placeholder
  console.log("Converting PDF to text");
  
  // This is a mock implementation - in production, use a proper PDF extraction library
  // or a service like AWS Textract
  return "This is simulated text extracted from a PDF file. " +
         "In a real implementation, you would use a PDF parsing library " +
         "such as pdf-parse, pdf2json, or AWS Textract service.";
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