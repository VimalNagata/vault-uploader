/**
 * Data Processing Orchestrator for Digital DNA
 * 
 * This Lambda function orchestrates the data processing pipeline by:
 * 1. Getting triggered when files are uploaded to any stage in S3
 * 2. Routing to the appropriate processor based on the stage:
 *    - stage1 files → categorize-user-data Lambda
 *    - stage2 files → persona-builder Lambda
 * 
 * Environment Variables:
 * - S3_BUCKET_NAME: The name of the S3 bucket for user data
 */

// Include dependencies
const AWS = require("aws-sdk");

// Initialize AWS clients
const lambda = new AWS.Lambda();
const s3 = new AWS.S3();

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
  
  // Route to appropriate processor based on stage
  if (stage === 'stage1') {
    // Raw data files - route to categorizer
    await invokeStage1Processor(bucket, key, userEmail);
  } else if (stage === 'stage2') {
    // Categorized files - route to persona builder
    await invokeStage2Processor(bucket, key, userEmail);
  } else {
    console.log(`No processor configured for stage: ${stage}`);
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
  
  const params = {
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
    const result = await lambda.invoke(params).promise();
    console.log(`Successfully initiated stage1 processing for ${key}`, result);
  } catch (error) {
    console.error(`Failed to invoke stage1 processor for ${key}:`, error);
    throw error;
  }
}

/**
 * Invoke the stage2 processor (persona-builder)
 * @param {string} bucket - S3 bucket name
 * @param {string} key - S3 object key
 * @param {string} userEmail - User's email
 */
async function invokeStage2Processor(bucket, key, userEmail) {
  console.log(`Invoking stage2 processor (persona-builder) for ${key}`);
  
  const params = {
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
    const result = await lambda.invoke(params).promise();
    console.log(`Successfully initiated stage2 processing for ${key}`, result);
  } catch (error) {
    console.error(`Failed to invoke stage2 processor for ${key}:`, error);
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