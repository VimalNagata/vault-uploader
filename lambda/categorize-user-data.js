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
    console.log(
      "Event received:",
      event.Records
        ? `S3 Event with ${event.Records.length} records`
        : `API Gateway Event (${event.httpMethod || "unknown method"})`
    );

    // Check if this is an S3 event
    if (event.Records && event.Records[0] && event.Records[0].s3) {
      return await handleS3Event(event);
    }

    // Otherwise, handle it as an API Gateway event
    return await handleApiGatewayEvent(event);
  } catch (error) {
    console.error(
      "Error in Lambda execution:",
      error.message,
      error.code || ""
    );

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

  // Try to get the user master file if it exists for context only
  let userMasterFile = null;
  try {
    userMasterFile = await getUserMasterFile(sanitizedEmail);
    console.log("Retrieved existing user master file for context");
  } catch (error) {
    console.log(
      "No existing user master file found for context:",
      error.message
    );
    // We don't need to create an empty one since we're not updating it
  }

  // Process the file content using OpenAI, passing the user master file for context
  const categoryData = await processFileWithOpenAI(
    fileName,
    fileContent,
    sanitizedEmail,
    userMasterFile
  );

  // Store the categorized data in stage2
  await storeProcessedData(sanitizedEmail, fileName, categoryData);
  
  // Trigger the user-profile-builder Lambda (this could be done via AWS SDK or EventBridge)
  // For now, we'll let the S3 event trigger handle it when the file is saved to stage2
  console.log("File processed. user-profile-builder will be triggered by S3 event");

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

    Use this information to supplement your analysis.
    `;
    console.log("Using existing user master file for context");
  } else {
    console.log("No existing user master file found");
  }

  // Get the prompt template from S3
  const promptTemplate = await getPromptTemplate("categorize-user-data");
  console.log("Retrieved prompt template from S3");

  // Replace template variables with actual values
  const prompt = promptTemplate
    .replace("{{fileName}}", fileName)
    .replace("{{userContext}}", userContext)
    .replace("{{content}}", truncatedContent);

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
 * Get a prompt template from S3
 * @param {string} promptName - The name of the prompt template to retrieve
 * @returns {Promise<string>} - The prompt template
 */
async function getPromptTemplate(promptName) {
  try {
    const promptsKey = `prompt-templates/prompts.json`;
    
    try {
      // Try to get the prompts file from S3
      const params = {
        Bucket: process.env.S3_BUCKET_NAME,
        Key: promptsKey,
      };

      const data = await s3.getObject(params).promise();
      const promptTemplates = JSON.parse(data.Body.toString("utf-8"));
      
      if (promptTemplates[promptName]) {
        return promptTemplates[promptName];
      }
      
      console.log(`Prompt template '${promptName}' not found, using default`);
    } catch (error) {
      if (error.code !== "NoSuchKey") {
        console.error("Error retrieving prompt templates:", error);
      }
      console.log("No prompt templates found in S3, using default");
    }

    // Default prompt template if not found in S3
    return `
    Analyze the following data export file and extract useful information. Pay attention to financial numbers and extract exact values.
    File name: {{fileName}}
  
    {{userContext}}
  
    This analysis has TWO purposes:
    1. Create a DETAILED SUMMARY of this specific file with extensive category information
    2. Extract FACTUAL METRICS for the user's master profile
  
    PART 1: DETAILED FILE SUMMARY
    Extract and categorize information into categories. The following base categories must always be considered:
    - financial: financial transactions, banking information, purchases, subscriptions
    - social: social connections, friends, followers, social interactions
    - professional: work history, skills, education, professional connections
    - entertainment: media consumption, content preferences, games, music, videos
  
    Additionally, identify and create ANY OTHER relevant categories based on the content.
    Be creative but precise when identifying new categories, such as:
    - health: medical records, fitness data, health metrics
    - travel: location history, trips, travel preferences
    - shopping: purchase history, product preferences
    - communication: emails, messages, contacts
    - etc. (identify any other relevant categories based on content)
  
    For each category:
    - Include a comprehensive summary that explains the nature and significance of the information
    - Extract detailed data points that highlight specific information found
    - Provide thorough analysis with context and relationships between data points
    - Identify patterns, trends, or interesting observations within each category
  
    PART 2: FACTUAL USER PROFILE METRICS
    At the same time, extract FACTUAL INFORMATION AND METRICS about the user, focusing on hard facts and quantifiable data.
  
    Focus on collecting these specific types of factual data:
    - Demographics: full name, exact age, gender, current location and previous locations
    - Relationships: marital status, spouse/partner name, number of children (with names and ages if available)
    - Financial Status: income range, savings amount, major assets, investment types, credit score range
    - Professional: current job title and employer, years of experience, number of previous employers, highest education level
    - Social: number of connections/friends (not all individual names), primary social platforms used, frequency of activity
    - Health: any medical conditions mentioned, height, weight, exercise frequency
    - Travel: number of trips taken, frequent destinations, typical accommodation preferences
    - Technology: devices owned, operating systems used, software preferences
  
    Provide METRICS whenever possible (counts, frequencies, ranges, amounts, etc.) rather than descriptive text.
    If exact values aren't available, provide reasonable estimations based on the data.
  
    Format your response as a JSON object with the following structure:
    {
      "fileName": "name of file",
      "fileType": "type of export (e.g. facebook, google, bank statement)",
      "summary": "detailed 3-5 sentence summary of what this file contains, why it's important, and key insights",
      "categories": {
        "financial": {
          "relevance": 0-10 score indicating how relevant this file is to this category,
          "summary": "comprehensive summary of financial information found with analysis and context",
          "dataPoints": ["detailed list", "of key data points", "with specific information"]
        },
        "social": { ... same structure with detailed summary and specific data points ... },
        "professional": { ... same structure with detailed summary and specific data points ... },
        "entertainment": { ... same structure with detailed summary and specific data points ... },
        "NEW_CATEGORY_NAME": { ... same structure with detailed summary and specific data points ... },
        ... add any other relevant categories with the same structure
      },
      "entityNames": ["list", "of", "entities", "mentioned"],
      "insights": ["list", "of", "potential", "insights", "including patterns and observations"],
      "sensitiveInfo": true/false,
      "userProfile": {
        "demographics": {
          "name": "user's full name if found",
          "age": "user's exact age if found (number)",
          "gender": "user's gender if found",
          "currentLocation": "user's current city, state, country",
          "previousLocations": ["location1", "location2"],
          "birthDate": "YYYY-MM-DD if found",
          "maritalStatus": "single/married/divorced/etc.",
          "familyMembers": {
            "spouse": "spouse name if applicable",
            "childrenCount": number of children if applicable,
            "children": ["child1 name and age", "child2 name and age"]
          }
        },
        "financialMetrics": {
          "incomeRange": "estimated annual income range in USD",
          "savingsEstimate": "estimated savings amount in USD",
          "majorAssets": ["home", "vehicle", etc.],
          "investmentTypes": ["stocks", "bonds", "real estate", etc.],
          "creditScoreRange": "credit score range if found",
          "subscriptionsCount": number of subscriptions found,
          "averageMonthlySpending": "estimated monthly spending in USD"
        },
        "professionalMetrics": {
          "currentEmployer": "current employer name",
          "currentTitle": "current job title",
          "yearsExperience": number of years of professional experience,
          "employerCount": number of previous employers,
          "highestEducation": "highest degree or education level",
          "skills": ["skill1", "skill2", "skill3"] (limit to top skills)
        },
        "socialMetrics": {
          "connectionsCount": total number of social connections found,
          "platformsUsed": ["platform1", "platform2"],
          "primaryPlatform": "most used social platform",
          "activityFrequency": "daily/weekly/monthly/etc."
        },
        "healthMetrics": {
          "conditions": ["condition1", "condition2"],
          "height": "height in cm or ft/in if found",
          "weight": "weight in kg or lbs if found",
          "exerciseFrequency": "times per week/month"
        },
        "travelMetrics": {
          "tripsCount": number of trips mentioned,
          "frequentDestinations": ["destination1", "destination2"],
          "accommodationPreference": "hotel/airbnb/etc."
        },
        "technologyMetrics": {
          "devicesOwned": ["device1", "device2"],
          "operatingSystems": ["OS1", "OS2"],
          "softwareUsed": ["software1", "software2"]
        },
        "interests": ["interest1", "interest2"] (limit to key interests)
      }
    }
  
    Only include categories where relevance > 0. The userProfile section should update and extend (not replace) any existing information from the user context. For each metric, only include it if you find relevant information in the data. Return the result as a JSON object with no additional text.
  
    Make the file summary and category summaries MUCH MORE DETAILED than the user profile metrics section. The file-specific information should be comprehensive and insightful, while the user profile metrics should focus on hard facts and numbers.
  
    Here's the file content:
    {{content}}
    `;
  } catch (error) {
    console.error("Error getting prompt template:", error);
    throw error;
  }
}

/**
 * Call OpenAI API with optimized configuration
 * @param {string} prompt - The prompt to send to OpenAI
 * @returns {Promise<string>} - The OpenAI response
 */
async function callOpenAI(prompt) {
  // Cache system message to avoid regenerating it with each call
  const systemMessage =
    "You are a data analyst specialized in categorizing and extracting insights from personal data exports. Extract structured information from files.";

  return new Promise((resolve, reject) => {
    // Use JSON.stringify once for better performance
    const openaiData = JSON.stringify({
      model: "gpt-3.5-turbo-1106",
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: prompt },
      ],
      temperature: 0.2, // Even lower temperature for more consistent, factual responses
      max_tokens: 4000,
      response_format: { type: "json_object" },
      top_p: 0.95, // Add top_p for better control of response quality
      // Note: timeout is set in the request options, not in the OpenAI API parameters
    });

    // Set up request options with efficient headers
    const options = {
      hostname: "api.openai.com",
      path: "/v1/chat/completions",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Length": Buffer.byteLength(openaiData),
      },
      timeout: 60000, // 60 second timeout
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
            const errorMsg =
              parsedResponse.error?.message || "Unknown API error";
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

// These functions have been moved to the user-profile-builder.js Lambda
