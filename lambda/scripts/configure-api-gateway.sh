#!/bin/bash
# Script to configure API Gateway for Digital DNA Lambda functions
# This script creates or updates an API Gateway REST API for the Lambda functions

set -e  # Exit immediately if a command exits with a non-zero status

# Set AWS region (can be overridden with environment variable)
AWS_REGION=${AWS_REGION:-"us-east-1"}

# API Gateway name
API_NAME="Digital-DNA-API"

# Function to display help message
show_help() {
  echo "Digital DNA API Gateway Configuration Tool"
  echo "========================================"
  echo ""
  echo "This script configures API Gateway for Digital DNA Lambda functions"
  echo ""
  echo "Usage: ./configure-api-gateway.sh [options]"
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
  echo "  ./configure-api-gateway.sh --deploy --stage dev"
  echo ""
}

# Default values
DEPLOY=false
STAGE_NAME="prod"

# Parse command-line arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --deploy)
      DEPLOY=true
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

# Function to check if a Lambda function exists
function_exists() {
  local function_name=$1
  aws lambda get-function --function-name "$function_name" --region "$AWS_REGION" >/dev/null 2>&1
  return $?
}

# Function to check if required Lambda functions exist
check_lambda_functions() {
  local missing_functions=false
  
  for func in "get-aws-credentials" "google-jwt-authorizer" "get-user-data-metrics"; do
    if ! function_exists "$func"; then
      echo "Error: Lambda function '$func' does not exist in $AWS_REGION"
      missing_functions=true
    fi
  done
  
  if [ "$missing_functions" = true ]; then
    echo "Please create the missing Lambda functions before configuring API Gateway."
    echo "You can use './deploy-lambda.sh <function-name> --create' to create them."
    exit 1
  fi
}

# Function to create or get API Gateway REST API
create_or_get_api() {
  # Check if API exists
  API_ID=$(aws apigateway get-rest-apis --region "$AWS_REGION" \
    --query "items[?name=='$API_NAME'].id" --output text)
  
  if [ -z "$API_ID" ] || [ "$API_ID" == "None" ]; then
    echo "Creating new API Gateway: $API_NAME"
    API_ID=$(aws apigateway create-rest-api \
      --name "$API_NAME" \
      --description "API for Digital DNA application" \
      --endpoint-configuration "types=REGIONAL" \
      --region "$AWS_REGION" \
      --query "id" --output text)
    echo "Created API Gateway with ID: $API_ID"
  else
    echo "Using existing API Gateway: $API_NAME (ID: $API_ID)"
  fi
  
  # Get the root resource ID
  ROOT_ID=$(aws apigateway get-resources \
    --rest-api-id "$API_ID" \
    --region "$AWS_REGION" \
    --query "items[?path=='/'].id" --output text)
}

# Function to create authorizer
create_authorizer() {
  # Check if authorizer already exists
  AUTHORIZER_ID=$(aws apigateway get-authorizers \
    --rest-api-id "$API_ID" \
    --region "$AWS_REGION" \
    --query "items[?name=='GoogleJwtAuthorizer'].id" --output text)
  
  if [ -z "$AUTHORIZER_ID" ] || [ "$AUTHORIZER_ID" == "None" ]; then
    echo "Creating Lambda authorizer using google-jwt-authorizer"
    
    # Get the Lambda function ARN
    AUTHORIZER_LAMBDA_ARN=$(aws lambda get-function \
      --function-name "google-jwt-authorizer" \
      --region "$AWS_REGION" \
      --query "Configuration.FunctionArn" --output text)
    
    # Create the authorizer
    AUTHORIZER_ID=$(aws apigateway create-authorizer \
      --rest-api-id "$API_ID" \
      --name "GoogleJwtAuthorizer" \
      --type "REQUEST" \
      --authorizer-uri "arn:aws:apigateway:$AWS_REGION:lambda:path/2015-03-31/functions/$AUTHORIZER_LAMBDA_ARN/invocations" \
      --identity-source "method.request.header.Authorization" \
      --authorizer-result-ttl-in-seconds 300 \
      --region "$AWS_REGION" \
      --query "id" --output text)
    
    echo "Created authorizer with ID: $AUTHORIZER_ID"
    
    # Add Lambda permission for API Gateway to invoke the authorizer
    aws lambda add-permission \
      --function-name "google-jwt-authorizer" \
      --statement-id "apigateway-authorizer-$API_ID" \
      --action "lambda:InvokeFunction" \
      --principal "apigateway.amazonaws.com" \
      --source-arn "arn:aws:execute-api:$AWS_REGION:$(aws sts get-caller-identity --query Account --output text):$API_ID/*/*" \
      --region "$AWS_REGION" || true
  else
    echo "Using existing authorizer with ID: $AUTHORIZER_ID"
  fi
}

# Function to create a resource
create_resource() {
  local path=$1
  local parent_id=$2
  
  # Check if resource already exists
  RESOURCE_ID=$(aws apigateway get-resources \
    --rest-api-id "$API_ID" \
    --region "$AWS_REGION" \
    --query "items[?path=='$path'].id" --output text)
  
  if [ -z "$RESOURCE_ID" ] || [ "$RESOURCE_ID" == "None" ]; then
    echo "Creating resource: $path"
    RESOURCE_ID=$(aws apigateway create-resource \
      --rest-api-id "$API_ID" \
      --parent-id "$parent_id" \
      --path-part "${path##*/}" \
      --region "$AWS_REGION" \
      --query "id" --output text)
    echo "Created resource with ID: $RESOURCE_ID"
  else
    echo "Using existing resource: $path (ID: $RESOURCE_ID)"
  fi
  
  echo "$RESOURCE_ID"
}

# Function to create method with authorizer
create_method() {
  local resource_id=$1
  local http_method=$2
  local lambda_function=$3
  
  # Check if method already exists
  local method_exists
  method_exists=$(aws apigateway get-method \
    --rest-api-id "$API_ID" \
    --resource-id "$resource_id" \
    --http-method "$http_method" \
    --region "$AWS_REGION" 2>/dev/null || echo "false")
  
  if [ "$method_exists" == "false" ]; then
    echo "Creating $http_method method for resource ID $resource_id with authorizer"
    
    # Create method with authorizer
    aws apigateway put-method \
      --rest-api-id "$API_ID" \
      --resource-id "$resource_id" \
      --http-method "$http_method" \
      --authorization-type "CUSTOM" \
      --authorizer-id "$AUTHORIZER_ID" \
      --region "$AWS_REGION"
    
    # Get the Lambda function ARN
    LAMBDA_ARN=$(aws lambda get-function \
      --function-name "$lambda_function" \
      --region "$AWS_REGION" \
      --query "Configuration.FunctionArn" --output text)
    
    # Set Lambda integration
    aws apigateway put-integration \
      --rest-api-id "$API_ID" \
      --resource-id "$resource_id" \
      --http-method "$http_method" \
      --type "AWS_PROXY" \
      --integration-http-method "POST" \
      --uri "arn:aws:apigateway:$AWS_REGION:lambda:path/2015-03-31/functions/$LAMBDA_ARN/invocations" \
      --region "$AWS_REGION"
    
    # Add Lambda permission for API Gateway to invoke the function
    aws lambda add-permission \
      --function-name "$lambda_function" \
      --statement-id "apigateway-$API_ID-$resource_id-$http_method" \
      --action "lambda:InvokeFunction" \
      --principal "apigateway.amazonaws.com" \
      --source-arn "arn:aws:execute-api:$AWS_REGION:$(aws sts get-caller-identity --query Account --output text):$API_ID/*/$http_method/*" \
      --region "$AWS_REGION" || true
    
    echo "Created $http_method method with Lambda integration: $lambda_function"
  else
    echo "Method $http_method already exists for resource ID $resource_id"
  fi
}

# Function to create OPTIONS method for CORS
create_options_method() {
  local resource_id=$1
  
  # Check if method already exists
  local method_exists
  method_exists=$(aws apigateway get-method \
    --rest-api-id "$API_ID" \
    --resource-id "$resource_id" \
    --http-method "OPTIONS" \
    --region "$AWS_REGION" 2>/dev/null || echo "false")
  
  if [ "$method_exists" == "false" ]; then
    echo "Creating OPTIONS method for CORS on resource ID $resource_id"
    
    # Create OPTIONS method (no authorization required)
    aws apigateway put-method \
      --rest-api-id "$API_ID" \
      --resource-id "$resource_id" \
      --http-method "OPTIONS" \
      --authorization-type "NONE" \
      --region "$AWS_REGION"
    
    # Create a mock integration
    aws apigateway put-integration \
      --rest-api-id "$API_ID" \
      --resource-id "$resource_id" \
      --http-method "OPTIONS" \
      --type "MOCK" \
      --integration-http-method "OPTIONS" \
      --request-templates '{"application/json":"{\"statusCode\": 200}"}' \
      --region "$AWS_REGION"
    
    # Set up the integration response with CORS headers
    aws apigateway put-integration-response \
      --rest-api-id "$API_ID" \
      --resource-id "$resource_id" \
      --http-method "OPTIONS" \
      --status-code "200" \
      --response-parameters "{\"method.response.header.Access-Control-Allow-Origin\":\"'*'\",\"method.response.header.Access-Control-Allow-Headers\":\"'Content-Type,Authorization'\",\"method.response.header.Access-Control-Allow-Methods\":\"'GET,OPTIONS'\"}" \
      --region "$AWS_REGION"
    
    # Set up the method response with CORS headers
    aws apigateway put-method-response \
      --rest-api-id "$API_ID" \
      --resource-id "$resource_id" \
      --http-method "OPTIONS" \
      --status-code "200" \
      --response-parameters "{\"method.response.header.Access-Control-Allow-Origin\":true,\"method.response.header.Access-Control-Allow-Headers\":true,\"method.response.header.Access-Control-Allow-Methods\":true}" \
      --region "$AWS_REGION"
    
    echo "Created OPTIONS method for CORS"
  else
    echo "OPTIONS method already exists for resource ID $resource_id"
  fi
}

# Function to deploy the API to a stage
deploy_api() {
  echo "Deploying API to stage: $STAGE_NAME"
  
  # Create deployment
  DEPLOYMENT_ID=$(aws apigateway create-deployment \
    --rest-api-id "$API_ID" \
    --stage-name "$STAGE_NAME" \
    --description "Deployed by configure-api-gateway.sh script" \
    --region "$AWS_REGION" \
    --query "id" --output text)
  
  echo "API deployed successfully to stage: $STAGE_NAME"
  echo "Deployment ID: $DEPLOYMENT_ID"
  
  # Get the API Gateway URL
  API_URL="https://$API_ID.execute-api.$AWS_REGION.amazonaws.com/$STAGE_NAME"
  echo ""
  echo "API Gateway Base URL: $API_URL"
  echo "Endpoints:"
  echo "- GET $API_URL/credentials"
  echo "- GET $API_URL/user-data-metrics"
}

# Main script execution
echo "Configuring API Gateway for Digital DNA Lambda functions..."

# Check if required Lambda functions exist
check_lambda_functions

# Create or get the API Gateway
create_or_get_api

# Create authorizer
create_authorizer

# Create credentials resource and methods
CREDENTIALS_RESOURCE=$(create_resource "/credentials" "$ROOT_ID")
create_method "$CREDENTIALS_RESOURCE" "GET" "get-aws-credentials"
create_options_method "$CREDENTIALS_RESOURCE"

# Create user-data-metrics resource and methods
METRICS_RESOURCE=$(create_resource "/user-data-metrics" "$ROOT_ID")
create_method "$METRICS_RESOURCE" "GET" "get-user-data-metrics"
create_options_method "$METRICS_RESOURCE"

# Deploy the API if requested
if [ "$DEPLOY" = true ]; then
  deploy_api
else
  echo ""
  echo "API Gateway configuration completed but not deployed."
  echo "To deploy the API, run: ./configure-api-gateway.sh --deploy"
fi

echo ""
echo "Configuration completed successfully!"