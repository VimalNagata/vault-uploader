#!/bin/bash
# Script to create a skeleton for a new AWS Lambda function

# Display help information
show_help() {
  echo "Create a Lambda Function Skeleton"
  echo "================================="
  echo ""
  echo "This script creates a skeleton for a new AWS Lambda function"
  echo ""
  echo "Usage: ./create-lambda-skeleton.sh <function-name> [description]"
  echo ""
  echo "Examples:"
  echo "  ./create-lambda-skeleton.sh analyze-user-data \"Analyze user data for insights\""
  echo "  ./create-lambda-skeleton.sh extract-metadata"
  echo ""
}

# Check for arguments
if [ $# -lt 1 ]; then
  show_help
  exit 1
fi

# Get function name from arguments
FUNCTION_NAME=$1
DESCRIPTION=${2:-"Lambda function for the Digital DNA project"}

# Check if file already exists
if [ -f "${FUNCTION_NAME}.js" ]; then
  echo "Error: File ${FUNCTION_NAME}.js already exists. Choose a different name."
  exit 1
fi

# Create the Lambda function file
cat > "${FUNCTION_NAME}.js" <<EOL
/**
 * ${DESCRIPTION}
 * 
 * This Lambda function is part of the Digital DNA application.
 * 
 * Environment Variables:
 * - S3_BUCKET_NAME: The name of the S3 bucket for user data
 */

// Include dependencies
const AWS = require("aws-sdk");

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
          "Access-Control-Allow-Origin": "*", // Update for production
          "Access-Control-Allow-Headers": "Content-Type,Authorization",
          "Access-Control-Allow-Methods": "GET,OPTIONS",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: "CORS preflight successful" }),
      };
    }

    // Get user email from authorization context
    const userEmail =
      event.requestContext?.authorizer?.email ||
      event.requestContext?.authorizer?.claims?.email ||
      event.requestContext?.authorizer?.context?.email;

    if (!userEmail) {
      console.error(
        "No user email found in authorizer context:",
        JSON.stringify(event.requestContext?.authorizer || {})
      );
      return {
        statusCode: 401,
        headers: getCorsHeaders(),
        body: JSON.stringify({
          message: "User not authenticated. No email found in authorizer context.",
          context: event.requestContext?.authorizer || "No authorizer context",
        }),
      };
    }

    console.log(\`Authenticated user: \${userEmail}\`);

    // Clean the email to use as a folder prefix
    const sanitizedEmail = userEmail.replace(/[^a-zA-Z0-9._-]/g, "_");

    // Verify environment variables
    if (!process.env.S3_BUCKET_NAME) {
      console.error("S3_BUCKET_NAME environment variable is not set");
      throw new Error("Lambda configuration error: S3_BUCKET_NAME is not set");
    }

    // TODO: Implement your Lambda function logic here
    const result = {
      message: "Function implementation pending",
      userEmail: sanitizedEmail,
      timestamp: new Date().toISOString()
    };

    // Return successful response
    return {
      statusCode: 200,
      headers: getCorsHeaders(),
      body: JSON.stringify(result),
    };
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
      headers: getCorsHeaders(),
      body: JSON.stringify({
        message: "Error processing request",
        error: errorDetails,
      }),
    };
  }
};

/**
 * Get standard CORS headers for responses
 */
function getCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*", // Update for production
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Content-Type": "application/json",
  };
}
EOL

echo "Created Lambda function skeleton: ${FUNCTION_NAME}.js"
echo ""
echo "Next steps:"
echo "1. Update the function with your implementation"
echo "2. Run './build-lambdas.sh' to create a deployment package"
echo "3. Deploy using './deploy-lambda.sh ${FUNCTION_NAME} --create'"
echo ""
echo "Don't forget to update the build-lambdas.sh script to include any additional dependencies!"

# Make the newly created lambda deployable
echo ""
echo "Updating build-lambdas.sh to include the new function..."

# Check if the function is already in build-lambdas.sh
if grep -q "create_lambda_package \"$FUNCTION_NAME\"" build-lambdas.sh; then
  echo "Function $FUNCTION_NAME is already in build-lambdas.sh"
else
  # Add the new function to build-lambdas.sh
  awk -v func_name="$FUNCTION_NAME" '
  /^echo "All Lambda packages created successfully!"/ {
    print "echo \"Building " func_name " Lambda...\"";
    print "create_lambda_package \"" func_name "\" '\''"aws-sdk": "^2.1469.0"'\''";
    print "";
    print $0;
    next;
  }
  { print }
  ' build-lambdas.sh > build-lambdas.sh.tmp
  
  mv build-lambdas.sh.tmp build-lambdas.sh
  chmod +x build-lambdas.sh
  
  echo "Added $FUNCTION_NAME to build-lambdas.sh"
fi

# Make the script executable
chmod +x "${FUNCTION_NAME}.js"
echo "Done!"