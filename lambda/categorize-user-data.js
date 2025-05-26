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
  "Access-Control-Allow-Headers":
    "Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Credentials": "true",
};

/**
 * Main Lambda handler function
 */
exports.handler = async (event) => {
  try {
    // Log minimal event information to reduce CloudWatch costs
    console.log("Event received:", 
      event.Records ? 
        `S3 Event with ${event.Records.length} records` : 
        `API Gateway Event (${event.httpMethod || 'unknown method'})`
    );

    // Check if this is an S3 event
    if (event.Records && event.Records[0] && event.Records[0].s3) {
      return await handleS3Event(event);
    }

    // Otherwise, handle it as an API Gateway event
    return await handleApiGatewayEvent(event);
  } catch (error) {
    console.error("Error in Lambda execution:", error.message, error.code || '');

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
  const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));

  console.log(`Processing S3 event: Bucket=${bucket}, Key=${key}`);

  // Extract userEmail and filePath from the S3 key
  // Format should be: <userEmail>/stage1/<filePath> or <userEmail>/preprocessed/<filePath>
  const keyParts = key.split("/");

  if (
    keyParts.length < 3 ||
    (keyParts[1] !== "stage1" && keyParts[1] !== "preprocessed")
  ) {
    console.error(
      `Invalid S3 key format: ${key}. Expected format: <userEmail>/stage1/<filePath> or <userEmail>/preprocessed/<filePath>`
    );
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
        message:
          "User not authenticated. No email found in authorizer context.",
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
        message:
          "Missing required parameters: filePath and fileName must be provided",
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
    body:
      result.body ||
      JSON.stringify({
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

  // Try to get the user master file if it exists
  let userMasterFile = null;
  try {
    userMasterFile = await getUserMasterFile(sanitizedEmail);
    console.log("Retrieved existing user master file");
  } catch (error) {
    console.log(
      "No existing user master file found or error retrieving it:",
      error.message
    );
    userMasterFile = {
      lastUpdated: new Date().toISOString(),
      fileCount: 0,
      userProfile: {
        demographics: {},
        financialMetrics: {},
        professionalMetrics: {},
        socialMetrics: {
          connectionsCount: 0,
          platformsUsed: [],
        },
        healthMetrics: {},
        travelMetrics: {},
        technologyMetrics: {},
        interests: [],
      },
    };
  }

  // Process the file content using OpenAI, passing the user master file for context
  const categoryData = await processFileWithOpenAI(
    fileName,
    fileContent,
    sanitizedEmail,
    userMasterFile
  );

  // Update the user master file with new information from the processed file
  const updatedMasterFile = updateUserMasterFile(userMasterFile, categoryData);

  // Store the updated master file
  await storeUserMasterFile(sanitizedEmail, updatedMasterFile);

  // Store the categorized data in stage2
  await storeProcessedData(sanitizedEmail, fileName, categoryData);

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: "File processed successfully",
      file: fileName,
      categories: Object.keys(categoryData.categories),
    }),
    categories: Object.keys(categoryData.categories),
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
  if (
    filePath.includes(`${userPrefix}/stage1/`) ||
    filePath.includes(`${userPrefix}/preprocessed/`)
  ) {
    key = filePath;
    console.log(`Using complete path: ${key}`);
  }
  // If filePath is just the file name or a subpath
  else {
    // Determine which stage to use based on the filePath
    const stage = filePath.includes("preprocessed/")
      ? "preprocessed"
      : "stage1";
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
    return data.Body.toString("utf-8");
  } catch (error) {
    console.error("Error retrieving file from S3:", error);
    throw new Error(`Failed to retrieve file: ${error.message}`);
  }
}

/**
 * Process file content using OpenAI
 * @param {string} fileName - The name of the file
 * @param {string} content - The content of the file
 * @param {string} userPrefix - The user's sanitized email
 * @param {Object} userMasterFile - The user's master file with entity information (if exists)
 * @returns {Promise<Object>} - Categorized data
 */
async function processFileWithOpenAI(
  fileName,
  content,
  userPrefix,
  userMasterFile
) {
  console.log(`Processing file: ${fileName}`);

  // Prepare content for OpenAI
  // Limit content to a reasonable size (e.g., first 100KB)
  const truncatedContent = content.substring(0, 100000);

  // Create a context section from the user master file if it exists
  let userContext = "";
  if (userMasterFile && Object.keys(userMasterFile).length > 0) {
    userContext = `
    User Information (from previous files):
    ${JSON.stringify(userMasterFile, null, 2)}

    Use this information to supplement your analysis and update it with any new details you find.
    `;
    console.log("Using existing user master file for context");
  } else {
    console.log("No existing user master file found, will create a new one");
  }

  // Define base categories and response schema (moved outside function for reuse & optimization)
  const baseCategories = {
    financial: "financial transactions, banking information, purchases, subscriptions",
    social: "social connections, friends, followers, social interactions",
    professional: "work history, skills, education, professional connections",
    entertainment: "media consumption, content preferences, games, music, videos"
  };
  
  const additionalCategories = {
    health: "medical records, fitness data, health metrics",
    travel: "location history, trips, travel preferences",
    shopping: "purchase history, product preferences",
    communication: "emails, messages, contacts"
  };
  
  // Prepare a concise but complete prompt for OpenAI
  const prompt = `
  Analyze the following data export and extract useful information. Extract specific financial numbers and metrics.
  File: ${fileName}
  ${userContext}

  Tasks:
  1. Create a DETAILED file summary with category information
  2. Extract FACTUAL user metrics - focus on hard facts, not inferences

  CATEGORIES:
  ${Object.entries(baseCategories).map(([cat, desc]) => `- ${cat}: ${desc}`).join('\n')}
  Also identify any other relevant categories like:
  ${Object.entries(additionalCategories).map(([cat, desc]) => `- ${cat}: ${desc}`).join('\n')}

  REQUIRED DATA:
  - Demographics: name, age, gender, location(s)
  - Financial: income, savings, assets, investments, credit score
  - Professional: employer, title, experience, education, skills
  - Social: connection counts, platforms used, activity frequency
  - Health: conditions, height, weight, exercise habits
  - Travel: trip count, destinations, accommodation preferences
  - Technology: devices, operating systems, software

  Output JSON format:
  {
    "fileName": "file name",
    "fileType": "export type (e.g. facebook, bank statement)",
    "summary": "detailed 3-5 sentence summary",
    "categories": {
      "categoryName": {
        "relevance": 0-10 score,
        "summary": "detailed analysis",
        "dataPoints": ["specific data point 1", "specific data point 2"]
      }
    },
    "entityNames": ["entity1", "entity2"],
    "insights": ["insight1", "insight2"],
    "sensitiveInfo": true/false,
    "userProfile": {
      "demographics": {...},
      "financialMetrics": {...},
      "professionalMetrics": {...},
      "socialMetrics": {...},
      "healthMetrics": {...},
      "travelMetrics": {...},
      "technologyMetrics": {...},
      "interests": [...]
    }
  }

  Only include categories with relevance > 0. For userProfile, only include factual information found in the data.
  File content:
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
            dataPoints: ["Error processing file"],
          },
        },
      };
    }
  } catch (error) {
    console.error("Error calling OpenAI API:", error);
    throw new Error(`OpenAI processing failed: ${error.message}`);
  }
}

/**
 * Call OpenAI API with optimized configuration
 * @param {string} prompt - The prompt to send to OpenAI
 * @returns {Promise<string>} - The OpenAI response
 */
async function callOpenAI(prompt) {
  // Cache system message to avoid regenerating it with each call
  const systemMessage = "You are a data analyst specialized in categorizing and extracting insights from personal data exports. Extract structured information from files.";
  
  return new Promise((resolve, reject) => {
    // Use JSON.stringify once for better performance
    const openaiData = JSON.stringify({
      model: "gpt-3.5-turbo-1106",
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: prompt }
      ],
      temperature: 0.2, // Even lower temperature for more consistent, factual responses
      max_tokens: 4000,
      response_format: { type: "json_object" },
      top_p: 0.95, // Add top_p for better control of response quality
      timeout: 60 // Add timeout to prevent hanging connections
    });

    // Set up request options with efficient headers
    const options = {
      hostname: "api.openai.com",
      path: "/v1/chat/completions",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Length": Buffer.byteLength(openaiData)
      },
      timeout: 60000 // 60 second timeout
    };

    // Create and manage the request
    const req = https.request(options, (res) => {
      // Use array buffer for more efficient memory usage with large responses
      const chunks = [];

      res.on("data", (chunk) => chunks.push(chunk));

      res.on("end", () => {
        try {
          // Combine chunks efficiently
          const responseData = Buffer.concat(chunks).toString();
          const parsedResponse = JSON.parse(responseData);
          
          if (res.statusCode >= 200 && res.statusCode < 300) {
            if (parsedResponse.choices?.[0]?.message?.content) {
              resolve(parsedResponse.choices[0].message.content);
            } else {
              reject(new Error("No valid content in OpenAI response"));
            }
          } else {
            const errorMsg = parsedResponse.error?.message || "Unknown API error";
            console.error("OpenAI API error:", errorMsg);
            reject(new Error(`OpenAI API error: ${errorMsg}`));
          }
        } catch (e) {
          reject(new Error(`Failed to parse OpenAI response: ${e.message}`));
        }
      });
    });

    // Add error handling
    req.on("error", (error) => {
      reject(new Error(`OpenAI request failed: ${error.message}`));
    });

    // Add timeout handling
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("OpenAI request timed out after 60 seconds"));
    });

    // Send the request
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

  console.log(
    `Storing processed data to S3: ${process.env.S3_BUCKET_NAME}/${targetKey}`
  );

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

/**
 * Get the user master file from S3 if it exists
 * @param {string} userPrefix - The user's sanitized email
 * @returns {Promise<Object>} - The user master file
 */
async function getUserMasterFile(userPrefix) {
  const masterFileKey = `${userPrefix}/stage2/user_master_profile.json`;

  console.log(
    `Retrieving user master file from S3: ${process.env.S3_BUCKET_NAME}/${masterFileKey}`
  );

  try {
    const params = {
      Bucket: process.env.S3_BUCKET_NAME,
      Key: masterFileKey,
    };

    const data = await s3.getObject(params).promise();
    return JSON.parse(data.Body.toString("utf-8"));
  } catch (error) {
    // If the file doesn't exist yet, that's ok - we'll create it
    if (error.code === "NoSuchKey") {
      throw new Error("User master file does not exist yet");
    }
    console.error("Error retrieving user master file:", error);
    throw new Error(`Failed to retrieve user master file: ${error.message}`);
  }
}

/**
 * Store the updated user master file in S3
 * @param {string} userPrefix - The user's sanitized email
 * @param {Object} masterFile - The user master file
 */
async function storeUserMasterFile(userPrefix, masterFile) {
  const masterFileKey = `${userPrefix}/stage2/user_master_profile.json`;

  console.log(
    `Storing user master file to S3: ${process.env.S3_BUCKET_NAME}/${masterFileKey}`
  );

  try {
    const params = {
      Bucket: process.env.S3_BUCKET_NAME,
      Key: masterFileKey,
      Body: JSON.stringify(masterFile, null, 2),
      ContentType: "application/json",
    };

    await s3.putObject(params).promise();
    console.log("User master file stored successfully");
  } catch (error) {
    console.error("Error storing user master file:", error);
    throw new Error(`Failed to store user master file: ${error.message}`);
  }
}

/**
 * Helper function to merge arrays with de-duplication
 * @param {Array} existingArray - Existing array to merge into
 * @param {Array} newArray - New array to merge from
 * @returns {Array} - Merged array with unique items
 */
function mergeArrays(existingArray = [], newArray = []) {
  if (!Array.isArray(newArray) || newArray.length === 0) return existingArray;
  if (!Array.isArray(existingArray)) existingArray = [];
  
  const existingSet = new Set(existingArray.map(item => 
    typeof item === "string" ? item.toLowerCase() : JSON.stringify(item)
  ));
  
  const result = [...existingArray];
  
  for (const item of newArray) {
    if (!item) continue;
    
    const itemKey = typeof item === "string" 
      ? item.toLowerCase() 
      : JSON.stringify(item);
      
    if (!existingSet.has(itemKey)) {
      result.push(item);
      existingSet.add(itemKey);
    }
  }
  
  return result;
}

/**
 * Update the user master file with new information
 * @param {Object} existingMasterFile - The existing user master file
 * @param {Object} newCategoryData - The new categorized data
 * @returns {Object} - The updated user master file
 */
function updateUserMasterFile(existingMasterFile, newCategoryData) {
  // Clone the existing master file to avoid mutations
  const updatedMasterFile = JSON.parse(JSON.stringify(existingMasterFile));

  // Update last processed time
  updatedMasterFile.lastUpdated = new Date().toISOString();
  updatedMasterFile.fileCount = (updatedMasterFile.fileCount || 0) + 1;

  // If we have a new user profile, use it to update the existing profile
  if (newCategoryData.userProfile) {
    // Ensure userProfile object exists
    updatedMasterFile.userProfile = updatedMasterFile.userProfile || { demographics: {}, interests: [] };
    
    // Update section objects with spread operator
    const sectionNames = [
      'demographics', 'financialMetrics', 'professionalMetrics', 
      'socialMetrics', 'healthMetrics', 'travelMetrics', 'technologyMetrics'
    ];
    
    for (const section of sectionNames) {
      if (newCategoryData.userProfile[section]) {
        // Ensure section exists
        updatedMasterFile.userProfile[section] = updatedMasterFile.userProfile[section] || {};
        
        // Merge objects
        updatedMasterFile.userProfile[section] = {
          ...updatedMasterFile.userProfile[section],
          ...newCategoryData.userProfile[section]
        };
        
        // Handle array properties based on section
        if (section === 'financialMetrics') {
          const arrayProps = ['majorAssets', 'investmentTypes'];
          for (const prop of arrayProps) {
            if (newCategoryData.userProfile[section][prop]) {
              updatedMasterFile.userProfile[section][prop] = mergeArrays(
                updatedMasterFile.userProfile[section][prop],
                newCategoryData.userProfile[section][prop]
              );
            }
          }
        } 
        else if (section === 'professionalMetrics' && newCategoryData.userProfile[section].skills) {
          updatedMasterFile.userProfile[section].skills = mergeArrays(
            updatedMasterFile.userProfile[section].skills,
            newCategoryData.userProfile[section].skills
          );
        }
        else if (section === 'socialMetrics' && newCategoryData.userProfile[section].platformsUsed) {
          updatedMasterFile.userProfile[section].platformsUsed = mergeArrays(
            updatedMasterFile.userProfile[section].platformsUsed,
            newCategoryData.userProfile[section].platformsUsed
          );
        }
        else if (section === 'healthMetrics' && newCategoryData.userProfile[section].conditions) {
          updatedMasterFile.userProfile[section].conditions = mergeArrays(
            updatedMasterFile.userProfile[section].conditions,
            newCategoryData.userProfile[section].conditions
          );
        }
        else if (section === 'travelMetrics' && newCategoryData.userProfile[section].frequentDestinations) {
          updatedMasterFile.userProfile[section].frequentDestinations = mergeArrays(
            updatedMasterFile.userProfile[section].frequentDestinations,
            newCategoryData.userProfile[section].frequentDestinations
          );
        }
        else if (section === 'technologyMetrics') {
          const arrayProps = ['devicesOwned', 'operatingSystems', 'softwareUsed'];
          for (const prop of arrayProps) {
            if (newCategoryData.userProfile[section][prop]) {
              updatedMasterFile.userProfile[section][prop] = mergeArrays(
                updatedMasterFile.userProfile[section][prop],
                newCategoryData.userProfile[section][prop]
              );
            }
          }
        }
      }
    }
    
    // Update interests (avoiding duplicates)
    if (newCategoryData.userProfile.interests) {
      updatedMasterFile.userProfile.interests = mergeArrays(
        updatedMasterFile.userProfile.interests,
        newCategoryData.userProfile.interests
      );
    }

    // Handle any other user profile properties we didn't explicitly process
    for (const [key, value] of Object.entries(newCategoryData.userProfile)) {
      if (!sectionNames.includes(key) && key !== 'interests') {
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          // For object properties, merge them
          updatedMasterFile.userProfile[key] = {
            ...(updatedMasterFile.userProfile[key] || {}),
            ...value,
          };
        } else if (Array.isArray(value)) {
          // For array properties, add unique items
          updatedMasterFile.userProfile[key] = mergeArrays(
            updatedMasterFile.userProfile[key],
            value
          );
        } else {
          // For primitive values, just assign
          updatedMasterFile.userProfile[key] = value;
        }
      }
    }
  }

  // Update category information
  updatedMasterFile.categories = updatedMasterFile.categories || {};

  if (newCategoryData.categories) {
    for (const [category, data] of Object.entries(newCategoryData.categories)) {
      if (!updatedMasterFile.categories[category]) {
        updatedMasterFile.categories[category] = {
          relevance: data.relevance || 0,
          count: 1,
          dataPoints: [...(data.dataPoints || [])],
        };
      } else {
        // Update existing category
        updatedMasterFile.categories[category].relevance = Math.max(
          updatedMasterFile.categories[category].relevance || 0,
          data.relevance || 0
        );
        updatedMasterFile.categories[category].count =
          (updatedMasterFile.categories[category].count || 0) + 1;

        // Add unique data points
        updatedMasterFile.categories[category].dataPoints = mergeArrays(
          updatedMasterFile.categories[category].dataPoints,
          data.dataPoints
        );
      }
    }
  }

  // Add any insights to the master file
  updatedMasterFile.insights = updatedMasterFile.insights || [];
  
  if (newCategoryData.insights && Array.isArray(newCategoryData.insights)) {
    updatedMasterFile.insights = mergeArrays(
      updatedMasterFile.insights,
      newCategoryData.insights
    );
  }

  // Add source files that contributed to this profile
  updatedMasterFile.sourceFiles = updatedMasterFile.sourceFiles || [];

  if (newCategoryData.fileName) {
    updatedMasterFile.sourceFiles.push({
      fileName: newCategoryData.fileName,
      fileType: newCategoryData.fileType || "unknown",
      processedAt: new Date().toISOString(),
      categories: Object.keys(newCategoryData.categories || {}),
    });
  }

  return updatedMasterFile;
}
