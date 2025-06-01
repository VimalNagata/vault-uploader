/**
 * Prompt Manager for Digital DNA
 *
 * This Lambda function manages the prompt templates used by other Lambda functions.
 * It allows admins to view and modify prompt templates stored in a dedicated S3 location.
 *
 * Environment Variables:
 * - S3_BUCKET_NAME: The name of the S3 bucket for user data
 */

// Include dependencies
const AWS = require("aws-sdk");

// Initialize AWS clients
const s3 = new AWS.S3();

// CORS headers for all responses
const corsHeaders = {
  "Access-Control-Allow-Origin": "*", // For production, change to your domain
  "Access-Control-Allow-Headers":
    "Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS,PUT",
  "Access-Control-Allow-Credentials": "true",
};

// List of admin email addresses
const ADMIN_EMAILS = ["patavardhan@gmail.com", "sharadnyc@gmail.com"];

// Default prompt templates - used when no custom templates exist
const DEFAULT_PROMPTS = {
  "categorize-user-data": `
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
  `,
  "persona-builder": `
  I'm building a personal data profile for a user. Please update their existing {{personaType}} persona with new information from a data file.

  Existing Persona:
  {{existingPersona}}

  New Data:
  - File: {{fileName}}
  - File Type: {{fileType}}
  - File Summary: {{fileSummary}}
  - Relevance to {{personaType}}: {{relevance}}/10
  - Category Summary: {{categorySummary}}
  - Data Points: {{dataPoints}}
  
  {{userProfile}}

  Instructions:
  1. Update the persona's traits with any new information
  2. Add new insights not previously mentioned
  3. Add the new file as a source
  4. Update the summary to be more comprehensive and usable by a ad-server or a campaign audience creation tool
  5. Increase the completeness score (current: {{completeness}}/100) based on how much new information was added

  Return the updated persona in JSON format with the following structure:
  {
    "type": "{{personaType}}",
    "name": "Updated name if needed",
    "lastUpdated": "{{timestamp}}",
    "completeness": updated score out of 100,
    "summary": "Updated summary",
    "insights": ["insight 1", "insight 2", ...],
    "dataPoints": ["dataPoint1", "dataPoint2", ...],
    "traits": {
      // Appropriate traits for this persona type with updated values
    },
    "sources": ["existing sources", "{{fileName}}"]
  }

  Only make changes to the persona that are supported by the new data. Don't remove existing information unless it's clearly contradicted.
  Return only the JSON object with no additional text.
  `
};

/**
 * Main Lambda handler function
 */
exports.handler = async (event) => {
  try {
    console.log("Event received:", JSON.stringify(event));

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

    // Check if user is an admin
    if (!ADMIN_EMAILS.includes(userEmail)) {
      console.log(`User ${userEmail} is not an admin`);
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({
          message: "Access denied. You must be an admin to manage prompts.",
        }),
      };
    }

    console.log(`Admin user: ${userEmail}`);

    // Handle different HTTP methods
    switch (event.httpMethod) {
      case "GET":
        return await handleGetPrompts();
      case "POST":
        return await handleCreatePrompt(JSON.parse(event.body));
      case "PUT":
        return await handleUpdatePrompt(JSON.parse(event.body));
      default:
        return {
          statusCode: 405,
          headers: corsHeaders,
          body: JSON.stringify({
            message: `Method ${event.httpMethod} not allowed`,
          }),
        };
    }
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
 * Handle GET request to list all prompts
 */
async function handleGetPrompts() {
  try {
    const promptsKey = `prompt-templates/prompts.json`;
    let promptTemplates = {};

    try {
      // Try to get the prompts file from S3
      const params = {
        Bucket: process.env.S3_BUCKET_NAME,
        Key: promptsKey,
      };

      const data = await s3.getObject(params).promise();
      promptTemplates = JSON.parse(data.Body.toString("utf-8"));
      console.log("Retrieved prompt templates from S3");
    } catch (error) {
      // If the file doesn't exist, use default prompts
      if (error.code === "NoSuchKey") {
        console.log("No prompt templates found, using defaults");
        promptTemplates = DEFAULT_PROMPTS;
        
        // Save default prompts to S3
        await savePrompts(promptTemplates);
      } else {
        console.error("Error retrieving prompt templates:", error);
        throw new Error(`Failed to retrieve prompt templates: ${error.message}`);
      }
    }

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: "Prompt templates retrieved successfully",
        prompts: promptTemplates,
      }),
    };
  } catch (error) {
    console.error("Error in handleGetPrompts:", error);
    throw error;
  }
}

/**
 * Handle POST request to create a new prompt
 */
async function handleCreatePrompt(requestBody) {
  try {
    const { name, template } = requestBody;

    if (!name || !template) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          message: "Missing required parameters: name and template must be provided",
        }),
      };
    }

    // Get existing prompts
    const promptsKey = `prompt-templates/prompts.json`;
    let promptTemplates = {};

    try {
      const params = {
        Bucket: process.env.S3_BUCKET_NAME,
        Key: promptsKey,
      };

      const data = await s3.getObject(params).promise();
      promptTemplates = JSON.parse(data.Body.toString("utf-8"));
    } catch (error) {
      if (error.code === "NoSuchKey") {
        console.log("No prompt templates found, creating new file");
        promptTemplates = DEFAULT_PROMPTS;
      } else {
        console.error("Error retrieving prompt templates:", error);
        throw new Error(`Failed to retrieve prompt templates: ${error.message}`);
      }
    }

    // Add new prompt template
    promptTemplates[name] = template;

    // Save updated prompts to S3
    await savePrompts(promptTemplates);

    return {
      statusCode: 201,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: `Prompt template '${name}' created successfully`,
        prompts: promptTemplates,
      }),
    };
  } catch (error) {
    console.error("Error in handleCreatePrompt:", error);
    throw error;
  }
}

/**
 * Handle PUT request to update an existing prompt
 */
async function handleUpdatePrompt(requestBody) {
  try {
    const { name, template } = requestBody;

    if (!name || !template) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          message: "Missing required parameters: name and template must be provided",
        }),
      };
    }

    // Get existing prompts
    const promptsKey = `prompt-templates/prompts.json`;
    let promptTemplates = {};

    try {
      const params = {
        Bucket: process.env.S3_BUCKET_NAME,
        Key: promptsKey,
      };

      const data = await s3.getObject(params).promise();
      promptTemplates = JSON.parse(data.Body.toString("utf-8"));
    } catch (error) {
      if (error.code === "NoSuchKey") {
        console.log("No prompt templates found, using defaults");
        promptTemplates = DEFAULT_PROMPTS;
      } else {
        console.error("Error retrieving prompt templates:", error);
        throw new Error(`Failed to retrieve prompt templates: ${error.message}`);
      }
    }

    // Check if prompt exists
    if (!promptTemplates[name] && !DEFAULT_PROMPTS[name]) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({
          message: `Prompt template '${name}' not found`,
        }),
      };
    }

    // Update prompt template
    promptTemplates[name] = template;

    // Save updated prompts to S3
    await savePrompts(promptTemplates);

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: `Prompt template '${name}' updated successfully`,
        prompts: promptTemplates,
      }),
    };
  } catch (error) {
    console.error("Error in handleUpdatePrompt:", error);
    throw error;
  }
}

/**
 * Save prompts to S3
 * @param {Object} promptTemplates - The prompt templates to save
 */
async function savePrompts(promptTemplates) {
  const promptsKey = `prompt-templates/prompts.json`;

  console.log(
    `Saving prompt templates to S3: ${process.env.S3_BUCKET_NAME}/${promptsKey}`
  );

  try {
    const params = {
      Bucket: process.env.S3_BUCKET_NAME,
      Key: promptsKey,
      Body: JSON.stringify(promptTemplates, null, 2),
      ContentType: "application/json",
    };

    await s3.putObject(params).promise();
    console.log("Prompt templates saved successfully");
  } catch (error) {
    console.error("Error saving prompt templates:", error);
    throw new Error(`Failed to save prompt templates: ${error.message}`);
  }
}