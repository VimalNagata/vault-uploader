/**
 * Categorize user data for the Digital DNA project
 * 
 * This Lambda function categorizes CCPA data exports from a user's raw files (stage1)
 * and organizes the summary into the "categorized" stage (stage2) for later use.
 * 
 * Can be triggered by:
 * 1. API Gateway POST request with filePath and fileName in the body
 * 2. S3 upload event when a file is added to <userEmail>/stage1/
 * 
 * Environment Variables:
 * - S3_BUCKET_NAME: The name of the S3 bucket for user data
 * - OPENAI_API_KEY: OpenAI API key for processing the data
 */

// Include dependencies
const AWS = require("aws-sdk");
const https = require("https");

// Initialize AWS clients
const s3 = new AWS.S3();

// CORS headers for all responses
const corsHeaders = {
  "Access-Control-Allow-Origin": "*", // For production, change to your domain
  "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Credentials": "true",
};

/**
 * Main Lambda handler function
 */
exports.handler = async (event) => {
  try {
    console.log("Event received:", JSON.stringify(event));

    // Check if this is an S3 event
    if (event.Records && event.Records[0] && event.Records[0].s3) {
      return await handleS3Event(event);
    } 
    
    // Otherwise, handle it as an API Gateway event
    return await handleApiGatewayEvent(event);
  } catch (error) {
    console.error("Error in Lambda execution:", error);

    // Extract useful information from the error object
    const errorDetails = {
      message: error.message,
      code: error.code,
      statusCode: error.statusCode,
      requestId: error.requestId,
    };

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        message: "Error processing request",
        error: errorDetails,
      }),
    };
  }
};

/**
 * Handle S3 event triggers (when a file is uploaded to S3)
 */
async function handleS3Event(event) {
  const record = event.Records[0];
  const bucket = record.s3.bucket.name;
  // Decode URL-encoded keys and replace '+' with spaces
  const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
  
  console.log(`Processing S3 event: Bucket=${bucket}, Key=${key}`);
  
  // Extract userEmail and filePath from the S3 key
  // Format should be: <userEmail>/stage1/<filePath> or <userEmail>/preprocessed/<filePath>
  const keyParts = key.split('/');
  
  if (keyParts.length < 3 || (keyParts[1] !== 'stage1' && keyParts[1] !== 'preprocessed')) {
    console.error(`Invalid S3 key format: ${key}. Expected format: <userEmail>/stage1/<filePath> or <userEmail>/preprocessed/<filePath>`);
    throw new Error("Invalid S3 key format");
  }
  
  const userEmail = keyParts[0];
  const fileName = keyParts[keyParts.length - 1];
  
  console.log(`Extracted userEmail: ${userEmail}`);
  console.log(`Extracted fileName: ${fileName}`);
  
  // Process the file
  return await processFile(userEmail, key, fileName);
}

/**
 * Handle API Gateway event (manual triggering via UI)
 */
async function handleApiGatewayEvent(event) {
  // Handle OPTIONS requests for CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message: "CORS preflight successful" }),
    };
  }

  // Get user email from authorization context or query parameters
  const userEmail =
    event.requestContext?.authorizer?.email ||
    event.requestContext?.authorizer?.claims?.email ||
    event.requestContext?.authorizer?.context?.email ||
    event.queryStringParameters?.email; // Temporary for testing

  if (!userEmail) {
    console.error(
      "No user email found in authorizer context:",
      JSON.stringify(event.requestContext?.authorizer || {})
    );
    return {
      statusCode: 401,
      headers: corsHeaders,
      body: JSON.stringify({
        message: "User not authenticated. No email found in authorizer context.",
        context: event.requestContext?.authorizer || "No authorizer context",
      }),
    };
  }

  console.log(`Authenticated user: ${userEmail}`);

  // Get file info from the request body
  const requestBody = JSON.parse(event.body || "{}");
  const { filePath, fileName } = requestBody;

  if (!filePath || !fileName) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        message: "Missing required parameters: filePath and fileName must be provided",
      }),
    };
  }

  // Process the file
  const result = await processFile(userEmail, filePath, fileName);
  
  // Format response for API Gateway
  return {
    statusCode: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
    body: result.body || JSON.stringify({
      message: "File processed successfully",
      file: fileName,
      categories: result.categories || ["unknown"],
    }),
  };
}

/**
 * Common file processing workflow
 * @param {string} userEmail - User's email
 * @param {string} filePath - Path to the file in S3
 * @param {string} fileName - Name of the file
 * @returns {Promise<Object>} - Processing result
 */
async function processFile(userEmail, filePath, fileName) {
  // Note: We're using the email as-is to match existing S3 structure
  const sanitizedEmail = userEmail;

  console.log(`Processing file: ${fileName} for user: ${sanitizedEmail}`);

  // Verify environment variables
  if (!process.env.S3_BUCKET_NAME) {
    console.error("S3_BUCKET_NAME environment variable is not set");
    throw new Error("Lambda configuration error: S3_BUCKET_NAME is not set");
  }

  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY environment variable is not set");
    throw new Error("Lambda configuration error: OPENAI_API_KEY is not set");
  }

  // Get the content of the specified file
  const fileContent = await getFileContent(sanitizedEmail, filePath);

  // Process the file content using OpenAI
  const categoryData = await processFileWithOpenAI(fileName, fileContent);

  // Store the categorized data in stage2
  await storeProcessedData(sanitizedEmail, fileName, categoryData);

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: "File processed successfully",
      file: fileName,
      categories: Object.keys(categoryData.categories),
    }),
    categories: Object.keys(categoryData.categories)
  };
}

/**
 * Get the content of a file from S3
 * @param {string} userPrefix - The user's sanitized email
 * @param {string} filePath - Path to the file in S3
 * @returns {Promise<string>} - The file content
 */
async function getFileContent(userPrefix, filePath) {
  // Normalize the path to avoid duplicated directories
  let key;
  
  console.log(`Original filePath: "${filePath}"`);
  console.log(`User prefix: "${userPrefix}"`);
  
  // Check if filePath is a complete path
  if (filePath.includes(`${userPrefix}/stage1/`) || filePath.includes(`${userPrefix}/preprocessed/`)) {
    key = filePath;
    console.log(`Using complete path: ${key}`);
  } 
  // If filePath is just the file name or a subpath
  else {
    // Determine which stage to use based on the filePath
    const stage = filePath.includes('preprocessed/') ? 'preprocessed' : 'stage1';
    key = `${userPrefix}/${stage}/${filePath.replace(/^\/+/, "")}`;
    console.log(`Constructed path: ${key}`);
  }
  
  // Remove any duplicate paths that might occur
  const duplicateStage1Path = `${userPrefix}/stage1/${userPrefix}/stage1/`;
  const duplicatePreprocessedPath = `${userPrefix}/preprocessed/${userPrefix}/preprocessed/`;
  
  if (key.includes(duplicateStage1Path)) {
    key = key.replace(duplicateStage1Path, `${userPrefix}/stage1/`);
    console.log(`Removed duplicate stage1 path, new key: ${key}`);
  }
  
  if (key.includes(duplicatePreprocessedPath)) {
    key = key.replace(duplicatePreprocessedPath, `${userPrefix}/preprocessed/`);
    console.log(`Removed duplicate preprocessed path, new key: ${key}`);
  }

  console.log(`Retrieving file from S3: ${process.env.S3_BUCKET_NAME}/${key}`);

  try {
    const params = {
      Bucket: process.env.S3_BUCKET_NAME,
      Key: key,
    };

    const data = await s3.getObject(params).promise();
    
    // Convert the buffer to a string
    return data.Body.toString('utf-8');
  } catch (error) {
    console.error("Error retrieving file from S3:", error);
    throw new Error(`Failed to retrieve file: ${error.message}`);
  }
}

/**
 * Process file content using OpenAI
 * @param {string} fileName - The name of the file
 * @param {string} content - The content of the file
 * @returns {Promise<Object>} - Categorized data
 */
async function processFileWithOpenAI(fileName, content) {
  console.log(`Processing file: ${fileName}`);

  // Prepare content for OpenAI
  // Limit content to a reasonable size (e.g., first 100KB)
  const truncatedContent = content.substring(0, 100000);

  // Prepare the prompt for OpenAI
  const prompt = `
  Analyze the following data export file and extract useful information.
  File name: ${fileName}
  
  Extract and categorize information into the following categories:
  - financial: financial transactions, banking information, purchases, subscriptions
  - social: social connections, friends, followers, social interactions
  - professional: work history, skills, education, professional connections
  - entertainment: media consumption, content preferences, games, music, videos
  
  For each category, extract relevant data points and provide a short summary.
  
  Format your response as a JSON object with the following structure:
  {
    "fileName": "name of file",
    "fileType": "type of export (e.g. facebook, google, bank statement)",
    "summary": "brief 2-3 sentence summary of what this file contains",
    "categories": {
      "financial": {
        "relevance": 0-10 score indicating how relevant this file is to this category,
        "summary": "summary of financial information found",
        "dataPoints": ["list", "of", "key", "data points"]
      },
      "social": { ... same structure ... },
      "professional": { ... same structure ... },
      "entertainment": { ... same structure ... }
    },
    "entityNames": ["list", "of", "entities", "mentioned"],
    "insights": ["list", "of", "potential", "insights"],
    "sensitiveInfo": true/false
  }
  
  Only include categories where relevance > 0. Return the result as a JSON object with no additional text.
  
  Here's the file content:
  ${truncatedContent}
  `;

  // Call OpenAI API
  try {
    const completionResponse = await callOpenAI(prompt);
    console.log("OpenAI processing complete");

    // Parse the response as JSON
    try {
      const jsonResponse = JSON.parse(completionResponse);
      return jsonResponse;
    } catch (parseError) {
      console.error("Failed to parse OpenAI response as JSON:", parseError);
      console.log("Response:", completionResponse);
      
      // Attempt to extract JSON from the response if it contains other text
      const jsonMatch = completionResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch (e) {
          console.error("Failed to extract JSON from response:", e);
        }
      }
      
      // Return a basic structure if we couldn't parse the response
      return {
        fileName: fileName,
        fileType: "unknown",
        summary: "Failed to analyze file content",
        categories: {
          unknown: {
            relevance: 1,
            summary: "Processing error occurred",
            dataPoints: ["Error processing file"]
          }
        }
      };
    }
  } catch (error) {
    console.error("Error calling OpenAI API:", error);
    throw new Error(`OpenAI processing failed: ${error.message}`);
  }
}

/**
 * Call OpenAI API
 * @param {string} prompt - The prompt to send to OpenAI
 * @returns {Promise<string>} - The OpenAI response
 */
async function callOpenAI(prompt) {
  return new Promise((resolve, reject) => {
    const openaiData = JSON.stringify({
      model: "gpt-3.5-turbo-1106", // or "gpt-4" for more advanced processing
      messages: [
        {
          role: "system",
          content: "You are a data analyst specialized in categorizing and extracting insights from personal data exports. Your task is to analyze files and extract structured information."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.3, // Lower temperature for more consistent, focused responses
      max_tokens: 4000,
      response_format: { type: "json_object" }
    });

    const options = {
      hostname: "api.openai.com",
      path: "/v1/chat/completions",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Length": Buffer.byteLength(openaiData)
      }
    };

    const req = https.request(options, (res) => {
      let responseData = "";

      res.on("data", (chunk) => {
        responseData += chunk;
      });

      res.on("end", () => {
        try {
          const parsedResponse = JSON.parse(responseData);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            if (parsedResponse.choices && parsedResponse.choices.length > 0) {
              resolve(parsedResponse.choices[0].message.content);
            } else {
              reject(new Error("No content in OpenAI response"));
            }
          } else {
            console.error("OpenAI API error:", parsedResponse);
            reject(new Error(`OpenAI API error: ${JSON.stringify(parsedResponse.error || parsedResponse)}`));
          }
        } catch (e) {
          reject(new Error(`Failed to parse OpenAI response: ${e.message}`));
        }
      });
    });

    req.on("error", (error) => {
      reject(new Error(`OpenAI request failed: ${error.message}`));
    });

    req.write(openaiData);
    req.end();
  });
}

/**
 * Store processed data in S3
 * @param {string} userPrefix - The user's sanitized email
 * @param {string} fileName - Original file name
 * @param {Object} processedData - The categorized data
 */
async function storeProcessedData(userPrefix, fileName, processedData) {
  // Create a JSON-friendly filename
  const jsonFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_") + ".json";
  const targetKey = `${userPrefix}/stage2/${jsonFileName}`;

  console.log(`Storing processed data to S3: ${process.env.S3_BUCKET_NAME}/${targetKey}`);

  try {
    const params = {
      Bucket: process.env.S3_BUCKET_NAME,
      Key: targetKey,
      Body: JSON.stringify(processedData, null, 2),
      ContentType: "application/json",
    };

    await s3.putObject(params).promise();
    console.log("Processed data stored successfully");
  } catch (error) {
    console.error("Error storing processed data:", error);
    throw new Error(`Failed to store processed data: ${error.message}`);
  }
}