#!/bin/bash
# Script to configure API Gateway for the categorize-user-data Lambda function

set -e  # Exit immediately if a command exits with a non-zero status

# Set AWS region (can be overridden with environment variable)
AWS_REGION=${AWS_REGION:-"us-east-1"}

# API Gateway name - use the same API as other functions
API_NAME="Digital-DNA-API"

# Function to display help message
show_help() {
  echo "Categorize Data API Gateway Configuration Tool"
  echo "=============================================="
  echo ""
  echo "This script configures API Gateway for the categorize-user-data Lambda function"
  echo ""
  echo "Usage: ./configure-categorize-api.sh [options]"
  echo ""
  echo "Options:"
  echo "  --deploy        Deploy the API to a stage after configuration"
  echo "  --stage NAME    Stage name for deployment (default: prod)"
  echo "  --help          Show this help message"
  echo ""
  echo "Environment Variables:"
  echo "  AWS_REGION      AWS region to deploy to (default: us-east-1)"
  echo ""
  echo "Example:"
  echo "  ./configure-categorize-api.sh --deploy"
  echo "  ./configure-categorize-api.sh --deploy --stage dev"
}

# Parse command line arguments
DEPLOY_API=false
STAGE_NAME="prod"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --deploy)
      DEPLOY_API=true
      shift
      ;;
    --stage)
      STAGE_NAME="$2"
      shift 2
      ;;
    --help)
      show_help
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      show_help
      exit 1
      ;;
  esac
done

echo "Configuring API Gateway in region: $AWS_REGION"

# Step 1: Get API ID or create a new API if it doesn't exist
API_ID=$(aws apigateway get-rest-apis --region $AWS_REGION --query "items[?name=='$API_NAME'].id" --output text)

if [ -z "$API_ID" ] || [ "$API_ID" == "None" ]; then
  echo "Creating new API Gateway: $API_NAME"
  API_ID=$(aws apigateway create-rest-api --name "$API_NAME" --region $AWS_REGION --query 'id' --output text)
  echo "Created API with ID: $API_ID"
else
  echo "Using existing API Gateway: $API_NAME (ID: $API_ID)"
fi

# Step 2: Get the root resource ID
ROOT_RESOURCE_ID=$(aws apigateway get-resources --rest-api-id $API_ID --region $AWS_REGION --query 'items[?path==`/`].id' --output text)
echo "Root resource ID: $ROOT_RESOURCE_ID"

# Step 3: Create or find the /categorize resource
CATEGORIZE_RESOURCE_ID=$(aws apigateway get-resources --rest-api-id $API_ID --region $AWS_REGION --query "items[?path=='/categorize'].id" --output text)

if [ -z "$CATEGORIZE_RESOURCE_ID" ] || [ "$CATEGORIZE_RESOURCE_ID" == "None" ]; then
  echo "Creating /categorize resource..."
  CATEGORIZE_RESOURCE_ID=$(aws apigateway create-resource --rest-api-id $API_ID --parent-id $ROOT_RESOURCE_ID --path-part "categorize" --region $AWS_REGION --query 'id' --output text)
  echo "Created /categorize resource with ID: $CATEGORIZE_RESOURCE_ID"
else
  echo "Using existing /categorize resource with ID: $CATEGORIZE_RESOURCE_ID"
fi

# Step 4: Find the authorizer ID
AUTHORIZER_ID=$(aws apigateway get-authorizers --rest-api-id $API_ID --region $AWS_REGION --query "items[?name=='GoogleJWTAuthorizer'].id" --output text)

if [ -z "$AUTHORIZER_ID" ] || [ "$AUTHORIZER_ID" == "None" ]; then
  echo "Error: GoogleJWTAuthorizer not found. Please create it first."
  exit 1
else
  echo "Found GoogleJWTAuthorizer with ID: $AUTHORIZER_ID"
fi

# Step 5: Get Lambda function ARN
LAMBDA_NAME="categorize-user-data"
LAMBDA_ARN=$(aws lambda get-function --function-name $LAMBDA_NAME --region $AWS_REGION --query 'Configuration.FunctionArn' --output text)

if [ -z "$LAMBDA_ARN" ] || [ "$LAMBDA_ARN" == "None" ]; then
  echo "Error: Lambda function $LAMBDA_NAME not found."
  echo "Please create it first using: ./deploy-lambda.sh $LAMBDA_NAME --create"
  exit 1
else
  echo "Found Lambda function: $LAMBDA_ARN"
fi

# Step 6: Add or update the POST method with the authorizer
echo "Adding POST method to /categorize resource..."
aws apigateway put-method \
  --rest-api-id $API_ID \
  --resource-id $CATEGORIZE_RESOURCE_ID \
  --http-method POST \
  --authorization-type CUSTOM \
  --authorizer-id $AUTHORIZER_ID \
  --region $AWS_REGION || echo "Method POST already exists, updating..."

# Step 7: Add Lambda integration
echo "Adding Lambda integration for POST method..."
aws apigateway put-integration \
  --rest-api-id $API_ID \
  --resource-id $CATEGORIZE_RESOURCE_ID \
  --http-method POST \
  --type AWS_PROXY \
  --integration-http-method POST \
  --uri "arn:aws:apigateway:$AWS_REGION:lambda:path/2015-03-31/functions/$LAMBDA_ARN/invocations" \
  --region $AWS_REGION || echo "Integration already exists, updating..."

# Step 8: Add OPTIONS method for CORS
echo "Adding OPTIONS method for CORS support..."
aws apigateway put-method \
  --rest-api-id $API_ID \
  --resource-id $CATEGORIZE_RESOURCE_ID \
  --http-method OPTIONS \
  --authorization-type NONE \
  --region $AWS_REGION || echo "Method OPTIONS already exists, updating..."

# Step 9: Add mock integration for OPTIONS
echo "Adding mock integration for OPTIONS method..."
aws apigateway put-integration \
  --rest-api-id $API_ID \
  --resource-id $CATEGORIZE_RESOURCE_ID \
  --http-method OPTIONS \
  --type MOCK \
  --request-templates '{"application/json": "{\"statusCode\": 200}"}' \
  --region $AWS_REGION || echo "Integration for OPTIONS already exists, updating..."

# Step 10: Set up method responses for OPTIONS
echo "Setting up method responses for OPTIONS..."
aws apigateway put-method-response \
  --rest-api-id $API_ID \
  --resource-id $CATEGORIZE_RESOURCE_ID \
  --http-method OPTIONS \
  --status-code 200 \
  --response-parameters '{"method.response.header.Access-Control-Allow-Headers":true,"method.response.header.Access-Control-Allow-Methods":true,"method.response.header.Access-Control-Allow-Origin":true}' \
  --region $AWS_REGION || echo "Method response already exists, updating..."

# Step 11: Set up integration responses for OPTIONS
echo "Setting up integration responses for OPTIONS..."
aws apigateway put-integration-response \
  --rest-api-id $API_ID \
  --resource-id $CATEGORIZE_RESOURCE_ID \
  --http-method OPTIONS \
  --status-code 200 \
  --response-parameters '{"method.response.header.Access-Control-Allow-Headers":"'"'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token'"'","method.response.header.Access-Control-Allow-Methods":"'"'GET,POST,OPTIONS'"'","method.response.header.Access-Control-Allow-Origin":"'"'*'"'"}' \
  --region $AWS_REGION || echo "Integration response already exists, updating..."

# Step 12: Add permission for API Gateway to invoke Lambda
echo "Adding Lambda permission for API Gateway..."
aws lambda add-permission \
  --function-name $LAMBDA_NAME \
  --statement-id apigateway-categorize-post-$(date +%s) \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:$AWS_REGION:$(aws sts get-caller-identity --query 'Account' --output text):$API_ID/*/$POST/categorize" \
  --region $AWS_REGION || echo "Permission may already exist"

# Step 13: Deploy the API if requested
if [ "$DEPLOY_API" = true ]; then
  echo "Deploying API to stage: $STAGE_NAME"
  DEPLOYMENT_ID=$(aws apigateway create-deployment \
    --rest-api-id $API_ID \
    --stage-name $STAGE_NAME \
    --region $AWS_REGION \
    --query 'id' --output text)
  
  echo "API deployed with deployment ID: $DEPLOYMENT_ID"
  
  # Get the API invoke URL
  API_URL="https://$API_ID.execute-api.$AWS_REGION.amazonaws.com/$STAGE_NAME"
  echo "API Gateway URL: $API_URL"
  echo "Categorize Endpoint: $API_URL/categorize"
  
  # Create a .env file with the API URL for the frontend
  echo "Adding API URL to .env.local in the project root..."
  cat > ../.env.local <<EOL
# API Gateway endpoints
REACT_APP_METRICS_API_URL=$API_URL/user-data-metrics
REACT_APP_CATEGORIZE_API_URL=$API_URL/categorize
EOL
  
  echo "Environment variables written to ../.env.local"
else
  echo "API not deployed. Use --deploy flag to deploy."
fi

echo "API Gateway configuration complete!"
echo "To deploy the API, run: ./configure-categorize-api.sh --deploy"
echo "To update the frontend to use the new API, update REACT_APP_CATEGORIZE_API_URL in your .env file"