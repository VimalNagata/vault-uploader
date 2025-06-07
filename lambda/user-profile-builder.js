/**
 * User Profile Builder for the Digital DNA project
 *
 * This Lambda function builds a comprehensive user profile directly from preprocessed data,
 * focusing on hard facts, numeric aggregations, and time-series metrics.
 *
 * Can be triggered by:
 * 1. API Gateway POST request with userEmail in the body
 * 2. S3 upload event when a file is added to <userEmail>/preprocessed/
 * 3. Data processing orchestrator
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

  // Extract userEmail from the S3 key
  // Format could be: <userEmail>/preprocessed/<filePath> or <userEmail>/stage1/<filePath>
  const keyParts = key.split("/");

  if (keyParts.length < 3) {
    console.error(`Invalid S3 key format: ${key}. Expected format: <userEmail>/<stage>/<filePath>`);
    throw new Error("Invalid S3 key format");
  }

  const userEmail = keyParts[0];
  const stage = keyParts[1];

  // We only want to process preprocessed files
  if (stage !== "preprocessed") {
    console.log(`Skipping non-preprocessed file in ${stage}`);
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: `Skipped processing file in ${stage}`,
      }),
    };
  }

  console.log(`Extracted userEmail: ${userEmail}`);

  // Update the user master profile
  return await updateUserProfile(userEmail);
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
    event.queryStringParameters?.email || // Temporary for testing
    JSON.parse(event.body || "{}").userEmail; // Allow userEmail in body

  if (!userEmail) {
    console.error(
      "No user email found in authorizer context or request body:",
      JSON.stringify(event.requestContext?.authorizer || {})
    );
    return {
      statusCode: 401,
      headers: corsHeaders,
      body: JSON.stringify({
        message:
          "User not authenticated. No email found in authorizer context or request body.",
        context: event.requestContext?.authorizer || "No authorizer context",
      }),
    };
  }

  console.log(`Authenticated user: ${userEmail}`);

  // Update the user master profile
  const result = await updateUserProfile(userEmail);

  // Format response for API Gateway
  return {
    statusCode: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: "User profile updated successfully",
      userEmail: userEmail,
    }),
  };
}

/**
 * Update the user master profile by processing preprocessed files
 * @param {string} userEmail - User's email
 * @returns {Promise<Object>} - Processing result
 */
async function updateUserProfile(userEmail) {
  // Note: We're using the email as-is to match existing S3 structure
  const sanitizedEmail = userEmail;

  console.log(`Updating profile for user: ${sanitizedEmail}`);

  // Verify environment variables
  if (!process.env.S3_BUCKET_NAME) {
    console.error("S3_BUCKET_NAME environment variable is not set");
    throw new Error("Lambda configuration error: S3_BUCKET_NAME is not set");
  }

  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY environment variable is not set");
    throw new Error("Lambda configuration error: OPENAI_API_KEY is not set");
  }

  // Get all preprocessed files for this user
  const preprocessedFiles = await listPreprocessedFiles(sanitizedEmail);
  console.log(`Found ${preprocessedFiles.length} preprocessed files`);

  // Get existing user profile if available
  let userProfile = null;
  try {
    userProfile = await getUserProfile(sanitizedEmail);
    console.log("Retrieved existing user profile");
  } catch (error) {
    console.log(
      "No existing user profile found or error retrieving it:",
      error.message
    );
    userProfile = {
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
        transportationMetrics: {
          rides: {},
          monthlySpending: {},
        },
        interests: [],
      },
      sourceFiles: [],
    };
  }

  // Process preprocessed files in batches
  const batchSize = 5; // Process 5 files at a time to avoid memory and rate limit issues
  for (let i = 0; i < preprocessedFiles.length; i += batchSize) {
    const batch = preprocessedFiles.slice(i, i + batchSize);
    
    console.log(`Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(preprocessedFiles.length/batchSize)}`);
    
    // Process each file in the batch sequentially to avoid rate limits
    for (let j = 0; j < batch.length; j++) {
      const file = batch[j];
      
      try {
        // Skip if file is already processed
        if (userProfile.sourceFiles.some(source => source.fileName === file)) {
          console.log(`File ${file} already processed, skipping`);
          continue;
        }
        
        console.log(`Processing file: ${file} (${j+1}/${batch.length} in current batch)`);
        
        // Add a small delay between files to avoid rate limits
        if (j > 0) {
          const staggerDelay = 1000 + Math.floor(Math.random() * 2000); // 1-3 second delay
          console.log(`Adding stagger delay of ${staggerDelay}ms before processing next file`);
          await delay(staggerDelay);
        }
        
        const fileContent = await getFileContent(sanitizedEmail, "preprocessed", file);
        
        // Extract metrics from the file
        const metrics = await extractMetricsWithOpenAI(file, fileContent, sanitizedEmail);
        
        // Add to source files
        userProfile.sourceFiles.push({
          fileName: file,
          processedAt: new Date().toISOString(),
        });
        
        // Update user profile with the new metrics right away
        if (metrics) {
          userProfile = mergeProfileMetrics(userProfile, metrics);
        }
      } catch (error) {
        console.error(`Error processing file ${file}:`, error.message);
        // Continue with next file even if one fails
      }
    }
    
    // Add a delay between batches
    if (i + batchSize < preprocessedFiles.length) {
      const batchDelay = 5000; // 5 second delay between batches
      console.log(`Batch complete. Adding ${batchDelay}ms delay before next batch`);
      await delay(batchDelay);
    }
  }

  // Update last processed time and file count
  userProfile.lastUpdated = new Date().toISOString();
  userProfile.fileCount = userProfile.sourceFiles.length;

  // Store the updated profile
  await storeUserProfile(sanitizedEmail, userProfile);

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: "User profile updated successfully",
      fileCount: preprocessedFiles.length,
    }),
  };
}

/**
 * List all preprocessed files for a user
 * @param {string} userPrefix - The user's sanitized email
 * @returns {Promise<Array<string>>} - List of file paths
 */
async function listPreprocessedFiles(userPrefix) {
  const prefix = `${userPrefix}/preprocessed/`;

  console.log(`Listing files in S3: ${process.env.S3_BUCKET_NAME}/${prefix}`);

  try {
    const params = {
      Bucket: process.env.S3_BUCKET_NAME,
      Prefix: prefix,
    };

    const data = await s3.listObjectsV2(params).promise();
    return data.Contents.map(item => item.Key.replace(prefix, '')).filter(name => name.length > 0);
  } catch (error) {
    console.error("Error listing files in S3:", error);
    throw new Error(`Failed to list files: ${error.message}`);
  }
}

/**
 * Get the content of a file from S3
 * @param {string} userPrefix - The user's sanitized email
 * @param {string} stage - The stage (preprocessed, stage1, etc.)
 * @param {string} fileName - Name of the file
 * @returns {Promise<string>} - The file content
 */
async function getFileContent(userPrefix, stage, fileName) {
  const key = `${userPrefix}/${stage}/${fileName}`;

  console.log(`Retrieving file from S3: ${process.env.S3_BUCKET_NAME}/${key}`);

  try {
    const params = {
      Bucket: process.env.S3_BUCKET_NAME,
      Key: key,
    };

    const data = await s3.getObject(params).promise();
    return data.Body.toString("utf-8");
  } catch (error) {
    console.error("Error retrieving file from S3:", error);
    throw new Error(`Failed to retrieve file: ${error.message}`);
  }
}

/**
 * Extract metrics from file content using OpenAI
 * @param {string} fileName - The name of the file
 * @param {string} content - The content of the file
 * @param {string} userPrefix - The user's sanitized email
 * @returns {Promise<Object>} - Extracted metrics
 */
async function extractMetricsWithOpenAI(fileName, content, userPrefix) {
  console.log(`Extracting metrics from file: ${fileName}`);

  // Prepare content for OpenAI
  // Limit content to a reasonable size (e.g., first 100KB)
  const truncatedContent = content.substring(0, 100000);

  // Get the prompt template from S3 or use default
  const promptTemplate = await getPromptTemplate("user-profile-metrics");
  console.log("Retrieved prompt template from S3");

  // Replace template variables with actual values
  const prompt = promptTemplate
    .replace("{{fileName}}", fileName)
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
        metrics: {
          error: "Failed to parse metrics from file content"
        }
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

    // Default prompt template for user profile metrics
    return `
    Analyze the following preprocessed data file and extract ONLY factual metrics and hard data points. Focus on quantitative information that can be directly measured or counted.

    File name: {{fileName}}
    
    METRICS TO EXTRACT:
    
    1. FINANCIAL METRICS
       - Transaction amounts (with dates)
       - Monthly spending totals
       - Subscription costs and frequencies
       - Income amounts (if available)
       - Savings/investment amounts
       - Recurring payment patterns
    
    2. TRANSPORTATION METRICS
       - Ride counts (by service: Uber, Lyft, etc.)
       - Monthly spending on transportation
       - Frequent destinations
       - Travel distances
       - Most active times/days for transportation
       - Average ride costs
    
    3. TRAVEL METRICS
       - Number of trips taken
       - Destinations visited (with dates)
       - Flight/hotel/rental car costs
       - Dining expenses during travel
       - Time spent at each destination
    
    4. TIME-BASED PATTERNS
       - Monthly spending breakdowns
       - Daily/weekly activity patterns
       - Seasonal variations in behavior
       - Year-over-year changes
    
    5. DEMOGRAPHIC FACTS
       - Name, age, location (if available)
       - Employment information
       - Address/contact information
       - Device usage information
    
    For numerical data, calculate:
    - Totals
    - Averages
    - Maximums/minimums
    - Frequency distributions
    - Time-series aggregations (daily, weekly, monthly)
    
    DO NOT include:
    - Categories or classifications
    - Subjective interpretations
    - Speculative insights
    - General summaries
    - Recommendations
    
    Format your response as a JSON object with the following structure:
    {
      "metrics": {
        "financial": {
          "transactions": [
            {"date": "YYYY-MM-DD", "amount": 123.45, "description": "brief factual description"}
          ],
          "monthlySpending": {
            "2023-01": 1234.56,
            "2023-02": 2345.67
          },
          "subscriptions": [
            {"service": "name", "cost": 12.34, "frequency": "monthly/yearly"}
          ],
          "totalSpent": 4567.89
        },
        "transportation": {
          "rides": {
            "total": 42,
            "uber": 24,
            "lyft": 18
          },
          "monthlySpending": {
            "2023-01": 123.45,
            "2023-02": 234.56
          },
          "frequentDestinations": [
            {"location": "place", "count": 5}
          ],
          "averageCost": 12.34
        },
        "travel": {
          "trips": [
            {"destination": "place", "dates": "YYYY-MM-DD to YYYY-MM-DD", "cost": 1234.56}
          ],
          "totalCost": 4567.89
        },
        "demographics": {
          "name": "if found",
          "age": 00,
          "location": "if found",
          "employment": "if found"
        }
      }
    }
    
    Include ONLY sections where you have concrete numerical data or verifiable facts. Do not include speculative information or empty/null values. Include specific dates whenever available.
    
    Here's the file content:
    {{content}}
    `;
  } catch (error) {
    console.error("Error getting prompt template:", error);
    throw error;
  }
}

/**
 * Simple delay function
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Call OpenAI API without retry logic (relying on orchestrator for rate limiting)
 * @param {string} prompt - The prompt to send to OpenAI
 * @returns {Promise<string>} - The OpenAI response
 */
async function callOpenAI(prompt) {
  // Cache system message to avoid regenerating it with each call
  const systemMessage =
    "You are a data analyst specialized in extracting quantitative metrics and factual information from personal data exports. Focus ONLY on hard facts, numbers, and metrics that can be directly measured or counted. Do not include categories, interpretations, or subjective analysis.";

  return await new Promise((resolve, reject) => {
    // Use JSON.stringify once for better performance
    const openaiData = JSON.stringify({
      model: "gpt-3.5-turbo-1106",
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: prompt },
      ],
      temperature: 0.1, // Lower temperature for more factual, consistent responses
      max_tokens: 4000,
      response_format: { type: "json_object" },
      top_p: 0.95,
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
 * Get the user profile from S3 if it exists
 * @param {string} userPrefix - The user's sanitized email
 * @returns {Promise<Object>} - The user profile
 */
async function getUserProfile(userPrefix) {
  const profileKey = `${userPrefix}/stage2/user_master_profile.json`;

  console.log(
    `Retrieving user profile from S3: ${process.env.S3_BUCKET_NAME}/${profileKey}`
  );

  try {
    const params = {
      Bucket: process.env.S3_BUCKET_NAME,
      Key: profileKey,
    };

    const data = await s3.getObject(params).promise();
    return JSON.parse(data.Body.toString("utf-8"));
  } catch (error) {
    // If the file doesn't exist yet, that's ok - we'll create it
    if (error.code === "NoSuchKey") {
      throw new Error("User profile does not exist yet");
    }
    console.error("Error retrieving user profile:", error);
    throw new Error(`Failed to retrieve user profile: ${error.message}`);
  }
}

/**
 * Store the user profile in S3
 * @param {string} userPrefix - The user's sanitized email
 * @param {Object} profile - The user profile
 */
async function storeUserProfile(userPrefix, profile) {
  const profileKey = `${userPrefix}/stage2/user_master_profile.json`;

  console.log(
    `Storing user profile to S3: ${process.env.S3_BUCKET_NAME}/${profileKey}`
  );

  try {
    const params = {
      Bucket: process.env.S3_BUCKET_NAME,
      Key: profileKey,
      Body: JSON.stringify(profile, null, 2),
      ContentType: "application/json",
    };

    await s3.putObject(params).promise();
    console.log("User profile stored successfully");
  } catch (error) {
    console.error("Error storing user profile:", error);
    throw new Error(`Failed to store user profile: ${error.message}`);
  }
}

/**
 * Merge new metrics into the existing user profile
 * @param {Object} existingProfile - The existing user profile
 * @param {Object} newMetrics - The new metrics to merge
 * @returns {Object} - The updated user profile
 */
function mergeProfileMetrics(existingProfile, newMetrics) {
  // Clone the existing profile to avoid mutations
  const updatedProfile = JSON.parse(JSON.stringify(existingProfile));
  
  // Extract metrics from the new data
  const metrics = newMetrics.metrics || {};
  
  // Financial metrics
  if (metrics.financial) {
    const financial = metrics.financial;
    updatedProfile.userProfile.financialMetrics = updatedProfile.userProfile.financialMetrics || {};
    
    // Transactions - append new transactions
    if (financial.transactions && Array.isArray(financial.transactions)) {
      updatedProfile.userProfile.financialMetrics.transactions = 
        [...(updatedProfile.userProfile.financialMetrics.transactions || []), ...financial.transactions];
    }
    
    // Monthly spending - merge with existing data
    if (financial.monthlySpending && typeof financial.monthlySpending === 'object') {
      updatedProfile.userProfile.financialMetrics.monthlySpending = 
        {...(updatedProfile.userProfile.financialMetrics.monthlySpending || {}), ...financial.monthlySpending};
    }
    
    // Subscriptions - merge with de-duplication by service name
    if (financial.subscriptions && Array.isArray(financial.subscriptions)) {
      const existingSubs = updatedProfile.userProfile.financialMetrics.subscriptions || [];
      const existingSubNames = new Set(existingSubs.map(sub => sub.service?.toLowerCase()));
      
      const newSubs = financial.subscriptions.filter(sub => 
        !existingSubNames.has(sub.service?.toLowerCase())
      );
      
      updatedProfile.userProfile.financialMetrics.subscriptions = [...existingSubs, ...newSubs];
    }
    
    // Update total spent by adding new total
    if (financial.totalSpent && typeof financial.totalSpent === 'number') {
      const existingTotal = updatedProfile.userProfile.financialMetrics.totalSpent || 0;
      updatedProfile.userProfile.financialMetrics.totalSpent = existingTotal + financial.totalSpent;
    }
  }
  
  // Transportation metrics
  if (metrics.transportation) {
    const transportation = metrics.transportation;
    updatedProfile.userProfile.transportationMetrics = updatedProfile.userProfile.transportationMetrics || {};
    
    // Rides - sum counts
    if (transportation.rides && typeof transportation.rides === 'object') {
      updatedProfile.userProfile.transportationMetrics.rides = 
        updatedProfile.userProfile.transportationMetrics.rides || {};
        
      // Add each ride service count
      for (const [service, count] of Object.entries(transportation.rides)) {
        if (service === 'total') continue; // Handle total separately
        const existingCount = updatedProfile.userProfile.transportationMetrics.rides[service] || 0;
        updatedProfile.userProfile.transportationMetrics.rides[service] = existingCount + count;
      }
      
      // Update total count
      const totalRides = Object.entries(updatedProfile.userProfile.transportationMetrics.rides)
        .reduce((sum, [service, count]) => service !== 'total' ? sum + count : sum, 0);
      updatedProfile.userProfile.transportationMetrics.rides.total = totalRides;
    }
    
    // Monthly spending - merge with existing data
    if (transportation.monthlySpending && typeof transportation.monthlySpending === 'object') {
      updatedProfile.userProfile.transportationMetrics.monthlySpending = 
        {...(updatedProfile.userProfile.transportationMetrics.monthlySpending || {}), ...transportation.monthlySpending};
    }
    
    // Frequent destinations - merge with count aggregation
    if (transportation.frequentDestinations && Array.isArray(transportation.frequentDestinations)) {
      const existingDests = updatedProfile.userProfile.transportationMetrics.frequentDestinations || [];
      const destMap = new Map();
      
      // Add existing destinations to map
      existingDests.forEach(dest => {
        destMap.set(dest.location.toLowerCase(), dest);
      });
      
      // Add or update with new destinations
      transportation.frequentDestinations.forEach(dest => {
        const key = dest.location.toLowerCase();
        if (destMap.has(key)) {
          // Update count
          destMap.get(key).count += dest.count;
        } else {
          // Add new destination
          destMap.set(key, dest);
        }
      });
      
      // Convert map back to array and sort by count
      updatedProfile.userProfile.transportationMetrics.frequentDestinations = 
        Array.from(destMap.values()).sort((a, b) => b.count - a.count);
    }
    
    // Average cost - compute weighted average
    if (transportation.averageCost && typeof transportation.averageCost === 'number') {
      const existingAvg = updatedProfile.userProfile.transportationMetrics.averageCost || 0;
      const existingRides = updatedProfile.userProfile.transportationMetrics.rides?.total || 0;
      const newRides = transportation.rides?.total || 0;
      
      if (existingAvg === 0 || existingRides === 0) {
        // If no existing data, just use the new average
        updatedProfile.userProfile.transportationMetrics.averageCost = transportation.averageCost;
      } else if (newRides > 0) {
        // Compute weighted average
        updatedProfile.userProfile.transportationMetrics.averageCost = 
          ((existingAvg * existingRides) + (transportation.averageCost * newRides)) / (existingRides + newRides);
      }
    }
  }
  
  // Travel metrics
  if (metrics.travel) {
    const travel = metrics.travel;
    updatedProfile.userProfile.travelMetrics = updatedProfile.userProfile.travelMetrics || {};
    
    // Trips - append new trips
    if (travel.trips && Array.isArray(travel.trips)) {
      updatedProfile.userProfile.travelMetrics.trips = 
        [...(updatedProfile.userProfile.travelMetrics.trips || []), ...travel.trips];
    }
    
    // Total cost - add new total
    if (travel.totalCost && typeof travel.totalCost === 'number') {
      const existingTotal = updatedProfile.userProfile.travelMetrics.totalCost || 0;
      updatedProfile.userProfile.travelMetrics.totalCost = existingTotal + travel.totalCost;
    }
    
    // Trip count
    if (travel.trips) {
      updatedProfile.userProfile.travelMetrics.tripCount = 
        (updatedProfile.userProfile.travelMetrics.trips || []).length;
    }
  }
  
  // Demographics - only update if values exist and aren't empty
  if (metrics.demographics) {
    const demographics = metrics.demographics;
    updatedProfile.userProfile.demographics = updatedProfile.userProfile.demographics || {};
    
    // Only update if new value exists and current is empty
    for (const [key, value] of Object.entries(demographics)) {
      if (value && (!updatedProfile.userProfile.demographics[key] || updatedProfile.userProfile.demographics[key] === "")) {
        updatedProfile.userProfile.demographics[key] = value;
      }
    }
  }
  
  return updatedProfile;
}