/**
 * Persona Builder for Digital DNA
 *
 * This Lambda function builds and updates user personas by:
 * 1. Reading categorized data from stage2
 * 2. Reading existing personas from stage3 (or creating new ones)
 * 3. Updating personas with new insights using OpenAI
 * 4. Saving updated personas to stage3
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

// Define persona types - including additional types that might come from the user master profile
const PERSONA_TYPES = {
  FINANCIAL: "financial",
  SOCIAL: "social",
  PROFESSIONAL: "professional",
  ENTERTAINMENT: "entertainment",
  HEALTH: "health",
  TRAVEL: "travel",
  SHOPPING: "shopping",
  COMMUNICATION: "communication",
  EDUCATION: "education",
  PERSONAL: "personal",
  // Additional common categories that might be identified by the open-ended categorization
  LOCATION: "location",
  DEVICE: "device",
  SEARCH: "search",
  FOOD: "food",
  FITNESS: "fitness",
  READING: "reading",
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
  const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));

  console.log(`Processing S3 event: Bucket=${bucket}, Key=${key}`);

  // Extract userEmail and filePath from the S3 key
  // Format should be: <userEmail>/stage2/<fileName>
  const keyParts = key.split("/");

  if (keyParts.length < 3 || keyParts[1] !== "stage2") {
    console.error(
      `Invalid S3 key format: ${key}. Expected format: <userEmail>/stage2/<fileName>`
    );
    throw new Error("Invalid S3 key format");
  }

  const userEmail = keyParts[0];
  const fileName = keyParts[keyParts.length - 1];

  console.log(
    `Processing categorized data for user ${userEmail}, file: ${fileName}`
  );

  // Process the file
  return await updatePersonas(userEmail, key, fileName);
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
  const result = await updatePersonas(userEmail, filePath, fileName);

  // Format response for API Gateway
  return {
    statusCode: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: "Personas updated successfully",
      file: fileName,
      updatedPersonas: result.updatedPersonas,
    }),
  };
}

/**
 * Update user personas based on categorized data
 * @param {string} userEmail - User's email
 * @param {string} filePath - Path to the categorized file in S3
 * @param {string} fileName - Name of the file
 * @returns {Promise<Object>} - Results of persona updates
 */
async function updatePersonas(userEmail, filePath, fileName) {
  // Verify environment variables
  if (!process.env.S3_BUCKET_NAME) {
    console.error("S3_BUCKET_NAME environment variable is not set");
    throw new Error("Lambda configuration error: S3_BUCKET_NAME is not set");
  }

  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY environment variable is not set");
    throw new Error("Lambda configuration error: OPENAI_API_KEY is not set");
  }

  // Get the categorized data from stage2
  const categorizedData = await getCategorizedData(userEmail, filePath);
  console.log(`Retrieved categorized data for ${fileName}`);

  // If no categories found or invalid format, exit early
  if (
    !categorizedData ||
    !categorizedData.categories ||
    Object.keys(categorizedData.categories).length === 0
  ) {
    console.error(`No valid categories found in ${fileName}`);
    return {
      updatedPersonas: [],
      message: "No valid categories found in file",
    };
  }

  // Get existing personas from stage3 or create new ones if they don't exist
  const personas = await getExistingPersonas(userEmail);

  // Track which personas were updated
  const updatedPersonas = [];

  // Try to get the user master profile for additional context
  let userMasterProfile = null;
  try {
    userMasterProfile = await getUserMasterProfile(userEmail);
    console.log("Retrieved user master profile for enhanced persona building");
  } catch (error) {
    console.log("No user master profile found, continuing without it:", error.message);
  }

  // For each category in the categorized data, update the corresponding persona
  for (const categoryType of Object.keys(categorizedData.categories)) {
    // Support all categories, not just the predefined ones
    console.log(`Updating ${categoryType} persona...`);

    // Get the category data
    const categoryData = categorizedData.categories[categoryType];

    // Get the existing persona for this category or create a new one
    let persona = personas[categoryType];
    if (!persona) {
      console.log(`Creating new persona for category: ${categoryType}`);
      persona = createDefaultPersona(categoryType);
      personas[categoryType] = persona;
    }

    // Update the persona with new data using OpenAI, including user master profile if available
    const updatedPersona = await updatePersonaWithOpenAI(
      persona,
      categoryData,
      categorizedData.fileName,
      categorizedData.fileType,
      categorizedData.summary,
      userMasterProfile?.userProfile // Pass user profile data if available
    );

    // Save the updated persona
    personas[categoryType] = updatedPersona;
    updatedPersonas.push(categoryType);
  }

  // Save all updated personas to S3
  await savePersonas(userEmail, personas);

  return {
    updatedPersonas,
    message: `Successfully updated ${updatedPersonas.length} personas`,
  };
}

/**
 * Get categorized data from S3
 * @param {string} userEmail - User's email
 * @param {string} filePath - Path to the categorized file in S3
 * @returns {Promise<Object>} - Categorized data
 */
async function getCategorizedData(userEmail, filePath) {
  let key = filePath;

  // If filePath doesn't include stage2, add it
  if (!filePath.includes(`${userEmail}/stage2/`)) {
    // Get just the filename from the path
    const fileName = filePath.split("/").pop();
    key = `${userEmail}/stage2/${fileName}`;
  }

  console.log(
    `Getting categorized data from S3: ${process.env.S3_BUCKET_NAME}/${key}`
  );

  try {
    const params = {
      Bucket: process.env.S3_BUCKET_NAME,
      Key: key,
    };

    const data = await s3.getObject(params).promise();

    // Parse the JSON content
    return JSON.parse(data.Body.toString("utf-8"));
  } catch (error) {
    console.error("Error retrieving categorized data from S3:", error);
    throw new Error(`Failed to retrieve categorized data: ${error.message}`);
  }
}

/**
 * Get existing personas from S3, or empty object if none exist
 * @param {string} userEmail - User's email
 * @returns {Promise<Object>} - Existing personas
 */
async function getExistingPersonas(userEmail) {
  const personasKey = `${userEmail}/stage3/personas.json`;

  try {
    console.log(
      `Checking for existing personas at ${process.env.S3_BUCKET_NAME}/${personasKey}`
    );

    const params = {
      Bucket: process.env.S3_BUCKET_NAME,
      Key: personasKey,
    };

    const data = await s3.getObject(params).promise();

    // Parse the JSON content
    return JSON.parse(data.Body.toString("utf-8"));
  } catch (error) {
    // If file doesn't exist, return empty object
    if (error.code === "NoSuchKey") {
      console.log("No existing personas found, creating new ones");
      return {};
    }

    console.error("Error retrieving existing personas from S3:", error);
    throw new Error(`Failed to retrieve existing personas: ${error.message}`);
  }
}

/**
 * Create a default persona for a category
 * @param {string} categoryType - Category type (financial, social, etc.)
 * @returns {Object} - Default persona
 */
function createDefaultPersona(categoryType) {
  const timestamp = new Date().toISOString();

  let persona = {
    type: categoryType,
    lastUpdated: timestamp,
    completeness: 10,
    dataPoints: [],
    summary: `Initial ${categoryType} persona`,
    insights: [],
    sources: [],
  };

  // Add category-specific defaults
  switch (categoryType) {
    case PERSONA_TYPES.FINANCIAL:
      persona.name = "Financial Profile";
      persona.traits = {
        spendingHabits: "Unknown",
        financialServices: [],
        subscriptions: [],
      };
      break;
    case PERSONA_TYPES.SOCIAL:
      persona.name = "Social Profile";
      persona.traits = {
        connections: 0,
        platforms: [],
        engagement: "Unknown",
      };
      break;
    case PERSONA_TYPES.PROFESSIONAL:
      persona.name = "Professional Profile";
      persona.traits = {
        skills: [],
        experience: [],
        education: [],
      };
      break;
    case PERSONA_TYPES.ENTERTAINMENT:
      persona.name = "Entertainment Profile";
      persona.traits = {
        preferences: [],
        platforms: [],
        content: [],
      };
      break;
    default:
      persona.name = "Custom Profile";
      persona.traits = {};
  }

  return persona;
}

/**
 * Update persona with new data using OpenAI
 * @param {Object} existingPersona - Existing persona
 * @param {Object} categoryData - New category data
 * @param {string} fileName - Source file name
 * @param {string} fileType - Source file type
 * @param {string} fileSummary - Source file summary
 * @param {Object} userProfile - User master profile data (optional)
 * @returns {Promise<Object>} - Updated persona
 */
async function updatePersonaWithOpenAI(
  existingPersona,
  categoryData,
  fileName,
  fileType,
  fileSummary,
  userProfile
) {
  console.log(`Updating ${existingPersona.type} persona with AI...`);

  // Prepare content for OpenAI
  const prompt = `
  I'm building a personal data profile for a user. Please update their existing ${
    existingPersona.type
  } persona with new information from a data file.

  Existing Persona:
  ${JSON.stringify(existingPersona, null, 2)}

  New Data:
  - File: ${fileName}
  - File Type: ${fileType}
  - File Summary: ${fileSummary}
  - Relevance to ${existingPersona.type}: ${categoryData.relevance}/10
  - Category Summary: ${categoryData.summary}
  - Data Points: ${JSON.stringify(categoryData.dataPoints)}
  
  ${
    userProfile
      ? `User Profile Information (from master profile):
  ${JSON.stringify(userProfile, null, 2)}`
      : ""
  }

  Instructions:
  1. Update the persona's traits with any new information
  2. Add new insights not previously mentioned
  3. Add the new file as a source
  4. Update the summary to be more comprehensive and usable by a ad-server or a campaign audience creation tool
  5. Increase the completeness score (current: ${
    existingPersona.completeness
  }/100) based on how much new information was added

  Return the updated persona in JSON format with the following structure:
  {
    "type": "${existingPersona.type}",
    "name": "Updated name if needed",
    "lastUpdated": "${new Date().toISOString()}",
    "completeness": updated score out of 100,
    "summary": "Updated summary",
    "insights": ["insight 1", "insight 2", ...],
    "dataPoints": ["dataPoint1", "dataPoint2", ...],
    "traits": {
      // Appropriate traits for this persona type with updated values
    },
    "sources": ["existing sources", "${fileName}"]
  }

  Only make changes to the persona that are supported by the new data. Don't remove existing information unless it's clearly contradicted.
  Return only the JSON object with no additional text.
  `;

  // Call OpenAI API
  try {
    const updatedPersonaJson = await callOpenAI(prompt);
    console.log(`Successfully updated ${existingPersona.type} persona`);

    // Parse the response as JSON
    try {
      return JSON.parse(updatedPersonaJson);
    } catch (parseError) {
      console.error("Failed to parse OpenAI response as JSON:", parseError);

      // Attempt to extract JSON from the response if it contains other text
      const jsonMatch = updatedPersonaJson.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch (e) {
          console.error("Failed to extract JSON from response:", e);
        }
      }

      // If we can't parse, return existing persona
      console.log("Returning original persona due to parsing error");
      return {
        ...existingPersona,
        lastUpdated: new Date().toISOString(),
        sources: [...(existingPersona.sources || []), fileName],
      };
    }
  } catch (error) {
    console.error("Error calling OpenAI API:", error);
    // Return existing persona with the new file as a source
    return {
      ...existingPersona,
      lastUpdated: new Date().toISOString(),
      sources: [...(existingPersona.sources || []), fileName],
    };
  }
}

/**
 * Get the user master profile from S3
 * @param {string} userEmail - User's email
 * @returns {Promise<Object>} - The user master profile
 */
async function getUserMasterProfile(userEmail) {
  const masterFileKey = `${userEmail}/stage2/user_master_profile.json`;
  
  console.log(`Getting user master profile from S3: ${process.env.S3_BUCKET_NAME}/${masterFileKey}`);

  try {
    const params = {
      Bucket: process.env.S3_BUCKET_NAME,
      Key: masterFileKey,
    };

    const data = await s3.getObject(params).promise();
    return JSON.parse(data.Body.toString('utf-8'));
  } catch (error) {
    console.error("Error retrieving user master profile from S3:", error);
    throw new Error(`Failed to retrieve user master profile: ${error.message}`);
  }
}

/**
 * Save personas to S3
 * @param {string} userEmail - User's email
 * @param {Object} personas - Personas to save
 */
async function savePersonas(userEmail, personas) {
  const personasKey = `${userEmail}/stage3/personas.json`;

  console.log(
    `Saving personas to S3: ${process.env.S3_BUCKET_NAME}/${personasKey}`
  );

  // Ensure personas have proper timestamps
  const timestamp = new Date().toISOString();
  for (const type in personas) {
    if (!personas[type].lastUpdated) {
      personas[type].lastUpdated = timestamp;
    }
  }

  try {
    const params = {
      Bucket: process.env.S3_BUCKET_NAME,
      Key: personasKey,
      Body: JSON.stringify(personas, null, 2),
      ContentType: "application/json",
    };

    await s3.putObject(params).promise();
    console.log("Personas saved successfully");
  } catch (error) {
    console.error("Error saving personas to S3:", error);
    throw new Error(`Failed to save personas: ${error.message}`);
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
          content:
            "You are a data analyst specialized in building comprehensive user personas from personal data exports. Your task is to integrate new information into existing personas.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.3, // Lower temperature for more consistent, focused responses
      max_tokens: 4000,
      response_format: { type: "json_object" },
    });

    const options = {
      hostname: "api.openai.com",
      path: "/v1/chat/completions",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Length": Buffer.byteLength(openaiData),
      },
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
            reject(
              new Error(
                `OpenAI API error: ${JSON.stringify(
                  parsedResponse.error || parsedResponse
                )}`
              )
            );
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
