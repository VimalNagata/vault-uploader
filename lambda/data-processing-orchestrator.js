/**
 * Data Processing Orchestrator for Digital DNA
 * 
 * This Lambda function orchestrates the data processing pipeline by:
 * 1. Getting triggered when files are uploaded to any stage in S3
 * 2. Routing to the appropriate processor based on the stage:
 *    - stage1 files → data-preprocessor Lambda
 *    - preprocessed files → categorize-user-data Lambda AND user-profile-builder Lambda
 *    - stage2 files → persona-builder Lambda (stage 3)
 * 3. Managing rate limiting and concurrent processing to prevent OpenAI API overload
 * 
 * Environment Variables:
 * - S3_BUCKET_NAME: The name of the S3 bucket for user data
 */

// Include dependencies
const AWS = require("aws-sdk");
const path = require("path");

// Initialize AWS clients
const lambda = new AWS.Lambda();
const s3 = new AWS.S3();

// Rate limiting configuration
const MAX_CONCURRENT_OPENAI_CALLS = 3; // Maximum number of concurrent OpenAI calls per user
const RATE_LIMIT_DELAY_MS = 2000; // Delay between OpenAI calls in milliseconds
const PROCESSING_DELAY_BASE_MS = 1000; // Base delay for staged processing
let activeProcessingCount = {}; // Track active processing by user email

/**
 * Main Lambda handler function
 */
exports.handler = async (event) => {
  try {
    console.log("Orchestrator received event:", JSON.stringify(event));

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
      body: JSON.stringify({ message: "Orchestration completed successfully" }),
    };
  } catch (error) {
    console.error("Error in orchestrator Lambda:", error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Error in orchestration process",
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
 * Simple delay function
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Track the number of active processes for rate limiting
 * @param {string} userEmail - User's email
 * @param {string} stage - Processing stage
 * @param {boolean} increment - True to increment, false to decrement
 * @returns {number} - Current count after operation
 */
function trackActiveProcessing(userEmail, stage, increment = true) {
  const key = `${userEmail}:${stage}`;
  
  if (!activeProcessingCount[key]) {
    activeProcessingCount[key] = 0;
  }
  
  if (increment) {
    activeProcessingCount[key]++;
  } else {
    activeProcessingCount[key] = Math.max(0, activeProcessingCount[key] - 1);
  }
  
  return activeProcessingCount[key];
}

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

  // Add rate limiting for OpenAI stages
  if (stage === 'preprocessed' || stage === 'stage2') {
    const activeCount = trackActiveProcessing(userEmail, stage, true);
    console.log(`Active processing count for ${userEmail} in ${stage}: ${activeCount}`);
    
    // Apply rate limiting if too many concurrent processes
    if (activeCount > MAX_CONCURRENT_OPENAI_CALLS) {
      // Calculate delay based on active count (the more active, the longer the delay)
      const additionalDelay = RATE_LIMIT_DELAY_MS * (activeCount - MAX_CONCURRENT_OPENAI_CALLS);
      console.log(`Applying rate limit delay of ${additionalDelay}ms for ${userEmail}`);
      await delay(additionalDelay);
    } else {
      // Add a small randomized delay even when under the limit to stagger requests
      const staggerDelay = Math.floor(Math.random() * PROCESSING_DELAY_BASE_MS);
      console.log(`Applying stagger delay of ${staggerDelay}ms for ${userEmail}`);
      await delay(staggerDelay);
    }
  }
  
  try {
    // Route to appropriate processor based on stage
    if (stage === 'stage1') {
      // Raw data files - route to preprocessor
      await invokePreprocessor(bucket, key, userEmail);
    } else if (stage === 'preprocessed') {
      // Preprocessed files - route to categorizer
      await invokeStage1Processor(bucket, key, userEmail);
    } else if (stage === 'stage2') {
      // Categorized files - route to persona builder
      await invokeStage2Processor(bucket, key, userEmail);
    } else {
      console.log(`No processor configured for stage: ${stage}`);
    }
  } finally {
    // Decrement active processing count when done (for OpenAI stages)
    if (stage === 'preprocessed' || stage === 'stage2') {
      const activeCount = trackActiveProcessing(userEmail, stage, false);
      console.log(`Reduced active processing count for ${userEmail} in ${stage} to ${activeCount}`);
    }
  }
}

/**
 * Invoke the preprocessor Lambda
 * @param {string} bucket - S3 bucket name
 * @param {string} key - S3 object key
 * @param {string} userEmail - User's email
 */
async function invokePreprocessor(bucket, key, userEmail) {
  const fileName = key.split('/').pop();
  
  // Skip processing if the file is too large (50MB)
  const fileInfo = await getFileInfo(bucket, key);
  if (fileInfo && fileInfo.ContentLength > 52428800) { // 50MB
    console.log(`File too large for auto-processing (${fileInfo.ContentLength} bytes): ${key}`);
    return;
  }
  
  console.log(`Invoking preprocessor for ${fileName}`);
  
  const params = {
    FunctionName: 'data-preprocessor',
    InvocationType: 'Event', // Asynchronous invocation
    Payload: JSON.stringify({
      Records: [{
        s3: {
          bucket: { name: bucket },
          object: { key: key }
        }
      }]
    })
  };
  
  try {
    const result = await lambda.invoke(params).promise();
    console.log(`Successfully initiated preprocessing for ${key}`, result);
  } catch (error) {
    console.error(`Failed to invoke preprocessor for ${key}:`, error);
    throw error;
  }
}

/**
 * Invoke the stage1 processor (categorize-user-data)
 * @param {string} bucket - S3 bucket name
 * @param {string} key - S3 object key
 * @param {string} userEmail - User's email
 */
async function invokeStage1Processor(bucket, key, userEmail) {
  const fileName = key.split('/').pop();
  
  // Skip processing if the file is too large
  const fileInfo = await getFileInfo(bucket, key);
  if (fileInfo && fileInfo.ContentLength > 10485760) { // 10MB
    console.log(`File too large for auto-processing (${fileInfo.ContentLength} bytes): ${key}`);
    return;
  }
  
  console.log(`Invoking stage1 processor (categorize-user-data) for ${fileName}`);
  
  const categorizeParams = {
    FunctionName: 'categorize-user-data',
    InvocationType: 'Event', // Asynchronous invocation
    Payload: JSON.stringify({
      Records: [{
        s3: {
          bucket: { name: bucket },
          object: { key: key }
        }
      }]
    })
  };
  
  try {
    const result = await lambda.invoke(categorizeParams).promise();
    console.log(`Successfully initiated categorization for ${key}`, result);
  } catch (error) {
    console.error(`Failed to invoke categorize-user-data for ${key}:`, error);
    throw error;
  }
  
  // Also invoke the user profile builder directly to process from preprocessed file
  console.log(`Invoking user profile builder for ${fileName}`);
  
  const profileParams = {
    FunctionName: 'user-profile-builder',
    InvocationType: 'Event', // Asynchronous invocation
    Payload: JSON.stringify({
      Records: [{
        s3: {
          bucket: { name: bucket },
          object: { key: key }
        }
      }]
    })
  };
  
  try {
    const profileResult = await lambda.invoke(profileParams).promise();
    console.log(`Successfully initiated profile building for ${key}`, profileResult);
  } catch (error) {
    console.error(`Failed to invoke user-profile-builder for ${key}:`, error);
    // Continue even if profile builder fails
    console.log("Continuing pipeline despite profile builder error");
  }
}

/**
 * Invoke the stage2 processor (persona-builder only)
 * Note: user-profile-builder is no longer called for stage2 files, only for preprocessed files
 * @param {string} bucket - S3 bucket name
 * @param {string} key - S3 object key
 * @param {string} userEmail - User's email
 */
async function invokeStage2Processor(bucket, key, userEmail) {
  // Skip the user master profile to avoid recursive processing
  if (key.endsWith('user_master_profile.json')) {
    console.log(`Skipping user_master_profile.json to avoid recursive processing`);
    return;
  }
  
  // Invoke the persona-builder (stage 3) only
  // Note: user-profile-builder is now only called for preprocessed files
  console.log(`Invoking stage3 processor (persona-builder) for ${key}`);
  
  const personaParams = {
    FunctionName: 'persona-builder',
    InvocationType: 'Event', // Asynchronous invocation
    Payload: JSON.stringify({
      Records: [{
        s3: {
          bucket: { name: bucket },
          object: { key: key }
        }
      }]
    })
  };
  
  try {
    const personaResult = await lambda.invoke(personaParams).promise();
    console.log(`Successfully initiated persona building for ${key}`, personaResult);
  } catch (error) {
    console.error(`Failed to invoke persona-builder for ${key}:`, error);
    throw error;
  }
}

/**
 * Get information about a file in S3
 * @param {string} bucket - S3 bucket name
 * @param {string} key - S3 object key
 * @returns {Promise<Object>} - File metadata
 */
async function getFileInfo(bucket, key) {
  try {
    const params = {
      Bucket: bucket,
      Key: key
    };
    
    return await s3.headObject(params).promise();
  } catch (error) {
    console.error(`Error getting file info for s3://${bucket}/${key}:`, error);
    return null;
  }
}