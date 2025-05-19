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
  
  // Try to get the user master file if it exists
  let userMasterFile = null;
  try {
    userMasterFile = await getUserMasterFile(sanitizedEmail);
    console.log("Retrieved existing user master file");
  } catch (error) {
    console.log("No existing user master file found or error retrieving it:", error.message);
    userMasterFile = { 
      lastUpdated: new Date().toISOString(),
      fileCount: 0,
      userProfile: {
        demographics: {},
        financialMetrics: {},
        professionalMetrics: {},
        socialMetrics: {
          connectionsCount: 0,
          platformsUsed: []
        },
        healthMetrics: {},
        travelMetrics: {},
        technologyMetrics: {},
        interests: []
      }
    };
  }

  // Process the file content using OpenAI, passing the user master file for context
  const categoryData = await processFileWithOpenAI(fileName, fileContent, sanitizedEmail, userMasterFile);

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
 * @param {string} userPrefix - The user's sanitized email
 * @param {Object} userMasterFile - The user's master file with entity information (if exists)
 * @returns {Promise<Object>} - Categorized data
 */
async function processFileWithOpenAI(fileName, content, userPrefix, userMasterFile) {
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

  // Prepare the prompt for OpenAI
  const prompt = `
  Analyze the following data export file and extract useful information.
  File name: ${fileName}
  
  ${userContext}
  
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

/**
 * Get the user master file from S3 if it exists
 * @param {string} userPrefix - The user's sanitized email
 * @returns {Promise<Object>} - The user master file
 */
async function getUserMasterFile(userPrefix) {
  const masterFileKey = `${userPrefix}/stage2/user_master_profile.json`;
  
  console.log(`Retrieving user master file from S3: ${process.env.S3_BUCKET_NAME}/${masterFileKey}`);

  try {
    const params = {
      Bucket: process.env.S3_BUCKET_NAME,
      Key: masterFileKey,
    };

    const data = await s3.getObject(params).promise();
    return JSON.parse(data.Body.toString('utf-8'));
  } catch (error) {
    // If the file doesn't exist yet, that's ok - we'll create it
    if (error.code === 'NoSuchKey') {
      throw new Error('User master file does not exist yet');
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
  
  console.log(`Storing user master file to S3: ${process.env.S3_BUCKET_NAME}/${masterFileKey}`);

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
    // Make sure the userProfile object exists in the master file
    if (!updatedMasterFile.userProfile) {
      updatedMasterFile.userProfile = {
        demographics: {},
        interests: []
      };
    }
    
    // Update demographics
    if (newCategoryData.userProfile.demographics) {
      updatedMasterFile.userProfile.demographics = {
        ...updatedMasterFile.userProfile.demographics,
        ...newCategoryData.userProfile.demographics
      };
    }
    
    // Update financial metrics
    if (newCategoryData.userProfile.financialMetrics) {
      if (!updatedMasterFile.userProfile.financialMetrics) {
        updatedMasterFile.userProfile.financialMetrics = {};
      }
      
      updatedMasterFile.userProfile.financialMetrics = {
        ...updatedMasterFile.userProfile.financialMetrics,
        ...newCategoryData.userProfile.financialMetrics
      };
      
      // Merge arrays if they exist
      if (newCategoryData.userProfile.financialMetrics.majorAssets && Array.isArray(newCategoryData.userProfile.financialMetrics.majorAssets)) {
        if (!updatedMasterFile.userProfile.financialMetrics.majorAssets) {
          updatedMasterFile.userProfile.financialMetrics.majorAssets = [];
        }
        
        const existingAssets = new Set(updatedMasterFile.userProfile.financialMetrics.majorAssets.map(asset => 
          typeof asset === 'string' ? asset.toLowerCase() : JSON.stringify(asset)
        ));
        
        for (const asset of newCategoryData.userProfile.financialMetrics.majorAssets) {
          if (!asset) continue;
          
          const assetKey = typeof asset === 'string' ? asset.toLowerCase() : JSON.stringify(asset);
          if (!existingAssets.has(assetKey)) {
            updatedMasterFile.userProfile.financialMetrics.majorAssets.push(asset);
          }
        }
      }
      
      // Merge investment types
      if (newCategoryData.userProfile.financialMetrics.investmentTypes && Array.isArray(newCategoryData.userProfile.financialMetrics.investmentTypes)) {
        if (!updatedMasterFile.userProfile.financialMetrics.investmentTypes) {
          updatedMasterFile.userProfile.financialMetrics.investmentTypes = [];
        }
        
        const existingInvestments = new Set(updatedMasterFile.userProfile.financialMetrics.investmentTypes.map(inv => 
          typeof inv === 'string' ? inv.toLowerCase() : JSON.stringify(inv)
        ));
        
        for (const investment of newCategoryData.userProfile.financialMetrics.investmentTypes) {
          if (!investment) continue;
          
          const invKey = typeof investment === 'string' ? investment.toLowerCase() : JSON.stringify(investment);
          if (!existingInvestments.has(invKey)) {
            updatedMasterFile.userProfile.financialMetrics.investmentTypes.push(investment);
          }
        }
      }
    }
    
    // Update professional metrics
    if (newCategoryData.userProfile.professionalMetrics) {
      if (!updatedMasterFile.userProfile.professionalMetrics) {
        updatedMasterFile.userProfile.professionalMetrics = {};
      }
      
      updatedMasterFile.userProfile.professionalMetrics = {
        ...updatedMasterFile.userProfile.professionalMetrics,
        ...newCategoryData.userProfile.professionalMetrics
      };
      
      // Merge skills
      if (newCategoryData.userProfile.professionalMetrics.skills && Array.isArray(newCategoryData.userProfile.professionalMetrics.skills)) {
        if (!updatedMasterFile.userProfile.professionalMetrics.skills) {
          updatedMasterFile.userProfile.professionalMetrics.skills = [];
        }
        
        const existingSkills = new Set(updatedMasterFile.userProfile.professionalMetrics.skills.map(skill => 
          typeof skill === 'string' ? skill.toLowerCase() : JSON.stringify(skill)
        ));
        
        for (const skill of newCategoryData.userProfile.professionalMetrics.skills) {
          if (!skill) continue;
          
          const skillKey = typeof skill === 'string' ? skill.toLowerCase() : JSON.stringify(skill);
          if (!existingSkills.has(skillKey)) {
            updatedMasterFile.userProfile.professionalMetrics.skills.push(skill);
          }
        }
      }
    }
    
    // Update social metrics
    if (newCategoryData.userProfile.socialMetrics) {
      if (!updatedMasterFile.userProfile.socialMetrics) {
        updatedMasterFile.userProfile.socialMetrics = {};
      }
      
      updatedMasterFile.userProfile.socialMetrics = {
        ...updatedMasterFile.userProfile.socialMetrics,
        ...newCategoryData.userProfile.socialMetrics
      };
      
      // Merge platforms used
      if (newCategoryData.userProfile.socialMetrics.platformsUsed && Array.isArray(newCategoryData.userProfile.socialMetrics.platformsUsed)) {
        if (!updatedMasterFile.userProfile.socialMetrics.platformsUsed) {
          updatedMasterFile.userProfile.socialMetrics.platformsUsed = [];
        }
        
        const existingPlatforms = new Set(updatedMasterFile.userProfile.socialMetrics.platformsUsed.map(platform => 
          typeof platform === 'string' ? platform.toLowerCase() : JSON.stringify(platform)
        ));
        
        for (const platform of newCategoryData.userProfile.socialMetrics.platformsUsed) {
          if (!platform) continue;
          
          const platformKey = typeof platform === 'string' ? platform.toLowerCase() : JSON.stringify(platform);
          if (!existingPlatforms.has(platformKey)) {
            updatedMasterFile.userProfile.socialMetrics.platformsUsed.push(platform);
          }
        }
      }
    }

    // Update health metrics
    if (newCategoryData.userProfile.healthMetrics) {
      if (!updatedMasterFile.userProfile.healthMetrics) {
        updatedMasterFile.userProfile.healthMetrics = {};
      }
      
      updatedMasterFile.userProfile.healthMetrics = {
        ...updatedMasterFile.userProfile.healthMetrics,
        ...newCategoryData.userProfile.healthMetrics
      };
      
      // Merge conditions
      if (newCategoryData.userProfile.healthMetrics.conditions && Array.isArray(newCategoryData.userProfile.healthMetrics.conditions)) {
        if (!updatedMasterFile.userProfile.healthMetrics.conditions) {
          updatedMasterFile.userProfile.healthMetrics.conditions = [];
        }
        
        const existingConditions = new Set(updatedMasterFile.userProfile.healthMetrics.conditions.map(condition => 
          typeof condition === 'string' ? condition.toLowerCase() : JSON.stringify(condition)
        ));
        
        for (const condition of newCategoryData.userProfile.healthMetrics.conditions) {
          if (!condition) continue;
          
          const conditionKey = typeof condition === 'string' ? condition.toLowerCase() : JSON.stringify(condition);
          if (!existingConditions.has(conditionKey)) {
            updatedMasterFile.userProfile.healthMetrics.conditions.push(condition);
          }
        }
      }
    }
    
    // Update travel metrics
    if (newCategoryData.userProfile.travelMetrics) {
      if (!updatedMasterFile.userProfile.travelMetrics) {
        updatedMasterFile.userProfile.travelMetrics = {};
      }
      
      updatedMasterFile.userProfile.travelMetrics = {
        ...updatedMasterFile.userProfile.travelMetrics,
        ...newCategoryData.userProfile.travelMetrics
      };
      
      // Merge frequent destinations
      if (newCategoryData.userProfile.travelMetrics.frequentDestinations && Array.isArray(newCategoryData.userProfile.travelMetrics.frequentDestinations)) {
        if (!updatedMasterFile.userProfile.travelMetrics.frequentDestinations) {
          updatedMasterFile.userProfile.travelMetrics.frequentDestinations = [];
        }
        
        const existingDestinations = new Set(updatedMasterFile.userProfile.travelMetrics.frequentDestinations.map(destination => 
          typeof destination === 'string' ? destination.toLowerCase() : JSON.stringify(destination)
        ));
        
        for (const destination of newCategoryData.userProfile.travelMetrics.frequentDestinations) {
          if (!destination) continue;
          
          const destinationKey = typeof destination === 'string' ? destination.toLowerCase() : JSON.stringify(destination);
          if (!existingDestinations.has(destinationKey)) {
            updatedMasterFile.userProfile.travelMetrics.frequentDestinations.push(destination);
          }
        }
      }
    }
    
    // Update technology metrics
    if (newCategoryData.userProfile.technologyMetrics) {
      if (!updatedMasterFile.userProfile.technologyMetrics) {
        updatedMasterFile.userProfile.technologyMetrics = {};
      }
      
      updatedMasterFile.userProfile.technologyMetrics = {
        ...updatedMasterFile.userProfile.technologyMetrics,
        ...newCategoryData.userProfile.technologyMetrics
      };
      
      // Merge arrays: devicesOwned, operatingSystems, softwareUsed
      const arrayProps = ['devicesOwned', 'operatingSystems', 'softwareUsed'];
      
      for (const prop of arrayProps) {
        if (newCategoryData.userProfile.technologyMetrics[prop] && Array.isArray(newCategoryData.userProfile.technologyMetrics[prop])) {
          if (!updatedMasterFile.userProfile.technologyMetrics[prop]) {
            updatedMasterFile.userProfile.technologyMetrics[prop] = [];
          }
          
          const existingItems = new Set(updatedMasterFile.userProfile.technologyMetrics[prop].map(item => 
            typeof item === 'string' ? item.toLowerCase() : JSON.stringify(item)
          ));
          
          for (const item of newCategoryData.userProfile.technologyMetrics[prop]) {
            if (!item) continue;
            
            const itemKey = typeof item === 'string' ? item.toLowerCase() : JSON.stringify(item);
            if (!existingItems.has(itemKey)) {
              updatedMasterFile.userProfile.technologyMetrics[prop].push(item);
            }
          }
        }
      }
    }
    
    // Update interests (avoiding duplicates)
    if (newCategoryData.userProfile.interests && Array.isArray(newCategoryData.userProfile.interests)) {
      if (!updatedMasterFile.userProfile.interests) {
        updatedMasterFile.userProfile.interests = [];
      }
      
      const existingInterests = new Set(
        updatedMasterFile.userProfile.interests.map(interest => interest.toLowerCase())
      );
      
      for (const interest of newCategoryData.userProfile.interests) {
        if (!interest) continue;
        
        const lowerInterest = interest.toLowerCase();
        if (!existingInterests.has(lowerInterest)) {
          updatedMasterFile.userProfile.interests.push(interest);
          existingInterests.add(lowerInterest);
        }
      }
    }
    
    // Handle any other user profile properties we didn't explicitly process
    for (const [key, value] of Object.entries(newCategoryData.userProfile)) {
      if (!['demographics', 'financialMetrics', 'professionalMetrics', 'socialMetrics', 
            'healthMetrics', 'travelMetrics', 'technologyMetrics', 'interests'].includes(key)) {
        
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          // For object properties, merge them
          updatedMasterFile.userProfile[key] = {
            ...(updatedMasterFile.userProfile[key] || {}),
            ...value
          };
        } else if (Array.isArray(value)) {
          // For array properties, add unique items
          if (!updatedMasterFile.userProfile[key]) {
            updatedMasterFile.userProfile[key] = [];
          }
          
          const existingItems = new Set(
            updatedMasterFile.userProfile[key].map(item => 
              typeof item === 'string' ? item.toLowerCase() : JSON.stringify(item)
            )
          );
          
          for (const item of value) {
            if (!item) continue;
            
            const itemKey = typeof item === 'string' ? item.toLowerCase() : JSON.stringify(item);
            if (!existingItems.has(itemKey)) {
              updatedMasterFile.userProfile[key].push(item);
            }
          }
        } else {
          // For primitive values, just assign
          updatedMasterFile.userProfile[key] = value;
        }
      }
    }
  }
  
  // Update category information
  if (!updatedMasterFile.categories) {
    updatedMasterFile.categories = {};
  }
  
  if (newCategoryData.categories) {
    for (const [category, data] of Object.entries(newCategoryData.categories)) {
      if (!updatedMasterFile.categories[category]) {
        updatedMasterFile.categories[category] = {
          relevance: data.relevance || 0,
          count: 1,
          dataPoints: [...(data.dataPoints || [])]
        };
      } else {
        // Update existing category
        updatedMasterFile.categories[category].relevance = Math.max(
          updatedMasterFile.categories[category].relevance || 0,
          data.relevance || 0
        );
        updatedMasterFile.categories[category].count = (updatedMasterFile.categories[category].count || 0) + 1;
        
        // Add unique data points
        const existingPoints = new Set(updatedMasterFile.categories[category].dataPoints || []);
        for (const point of (data.dataPoints || [])) {
          if (!existingPoints.has(point)) {
            updatedMasterFile.categories[category].dataPoints = 
              updatedMasterFile.categories[category].dataPoints || [];
            updatedMasterFile.categories[category].dataPoints.push(point);
            existingPoints.add(point);
          }
        }
      }
    }
  }
  
  // Add any insights to the master file
  if (!updatedMasterFile.insights) {
    updatedMasterFile.insights = [];
  }
  
  if (newCategoryData.insights && Array.isArray(newCategoryData.insights)) {
    const existingInsights = new Set(
      updatedMasterFile.insights.map(insight => insight.toLowerCase())
    );
    
    for (const insight of newCategoryData.insights) {
      if (!insight) continue;
      
      const lowerInsight = insight.toLowerCase();
      if (!existingInsights.has(lowerInsight)) {
        updatedMasterFile.insights.push(insight);
        existingInsights.add(lowerInsight);
      }
    }
  }
  
  // Add source files that contributed to this profile
  if (!updatedMasterFile.sourceFiles) {
    updatedMasterFile.sourceFiles = [];
  }
  
  if (newCategoryData.fileName) {
    updatedMasterFile.sourceFiles.push({
      fileName: newCategoryData.fileName,
      fileType: newCategoryData.fileType || 'unknown',
      processedAt: new Date().toISOString(),
      categories: Object.keys(newCategoryData.categories || {})
    });
  }
  
  return updatedMasterFile;
}