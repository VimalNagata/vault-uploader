#!/bin/bash
# Consolidated script to configure API Gateway for all Digital DNA Lambda functions

set -e  # Exit immediately if a command exits with a non-zero status

# Set AWS region (can be overridden with environment variable)
AWS_REGION=${AWS_REGION:-"us-east-1"}

# API Gateway name
API_NAME="dee-en-eh-api"
STAGE_NAME="prod"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to display help message
show_help() {
  echo -e "${BLUE}Digital DNA API Gateway Configuration Tool${NC}"
  echo "========================================"
  echo ""
  echo "This script configures API Gateway for all Digital DNA Lambda functions"
  echo ""
  echo "Usage: ./configure-all-apis.sh [options] [functions]"
  echo ""
  echo "Options:"
  echo "  --deploy            Deploy the API to a stage after configuration"
  echo "  --stage NAME        Stage name for deployment (default: prod)"
  echo "  --region REGION     AWS region to deploy to (default: us-east-1)"
  echo "  --help              Show this help message"
  echo ""
  echo "Functions (specify which to configure, default is all):"
  echo "  credentials         Configure get-aws-credentials API"
  echo "  metrics             Configure get-user-data-metrics API"
  echo "  prompt-manager      Configure prompt-manager API"
  echo "  user-profile        Configure user-profile-builder API" 
  echo "  categorize          Configure categorize-user-data API"
  echo "  all                 Configure all APIs (default)"
  echo ""
  echo "Example:"
  echo "  ./configure-all-apis.sh --deploy --stage dev prompt-manager user-profile"
  echo ""
}

# Default values
DEPLOY=false
CONFIGURE_ALL=true
CONFIGURE_CREDENTIALS=false
CONFIGURE_METRICS=false
CONFIGURE_PROMPT_MANAGER=false
CONFIGURE_USER_PROFILE=false
CONFIGURE_CATEGORIZE=false

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
    --region)
      AWS_REGION="$2"
      shift 2
      ;;
    --help)
      show_help
      exit 0
      ;;
    credentials)
      CONFIGURE_ALL=false
      CONFIGURE_CREDENTIALS=true
      shift
      ;;
    metrics)
      CONFIGURE_ALL=false
      CONFIGURE_METRICS=true
      shift
      ;;
    prompt-manager)
      CONFIGURE_ALL=false
      CONFIGURE_PROMPT_MANAGER=true
      shift
      ;;
    user-profile)
      CONFIGURE_ALL=false
      CONFIGURE_USER_PROFILE=true
      shift
      ;;
    categorize)
      CONFIGURE_ALL=false
      CONFIGURE_CATEGORIZE=true
      shift
      ;;
    all)
      CONFIGURE_ALL=true
      shift
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      show_help
      exit 1
      ;;
  esac
done

# If all is configured, set all specific flags to true
if [ "$CONFIGURE_ALL" = true ]; then
  CONFIGURE_CREDENTIALS=true
  CONFIGURE_METRICS=true
  CONFIGURE_PROMPT_MANAGER=true
  CONFIGURE_USER_PROFILE=true
  CONFIGURE_CATEGORIZE=true
fi

# Function to check if a Lambda function exists
function_exists() {
  local function_name=$1
  aws lambda get-function --function-name "$function_name" --region "$AWS_REGION" >/dev/null 2>&1
  return $?
}

# Function to check if required Lambda functions exist
check_lambda_functions() {
  local missing_functions=false
  local functions_to_check=()
  
  # Add functions to check based on what we're configuring
  if [ "$CONFIGURE_CREDENTIALS" = true ]; then
    functions_to_check+=("get-aws-credentials")
  fi
  
  if [ "$CONFIGURE_METRICS" = true ]; then
    functions_to_check+=("get-user-data-metrics")
  fi
  
  if [ "$CONFIGURE_PROMPT_MANAGER" = true ]; then
    functions_to_check+=("prompt-manager")
  fi
  
  if [ "$CONFIGURE_USER_PROFILE" = true ]; then
    functions_to_check+=("user-profile-builder")
  fi
  
  if [ "$CONFIGURE_CATEGORIZE" = true ]; then
    functions_to_check+=("categorize-user-data")
  fi
  
  # Always check for the authorizer
  functions_to_check+=("google-jwt-authorizer")
  
  for func in "${functions_to_check[@]}"; do
    if ! function_exists "$func"; then
      echo -e "${RED}Error: Lambda function '$func' does not exist in $AWS_REGION${NC}"
      missing_functions=true
    fi
  done
  
  if [ "$missing_functions" = true ]; then
    echo -e "${YELLOW}Please create the missing Lambda functions before configuring API Gateway.${NC}"
    echo "You can use './deploy-lambda-function.sh <function-name>' to create them."
    exit 1
  fi
}

# Function to create or get API Gateway REST API
create_or_get_api() {
  echo -e "${BLUE}Setting up API Gateway...${NC}"
  
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
    echo -e "${GREEN}Created API Gateway with ID: $API_ID${NC}"
  else
    echo -e "${YELLOW}Using existing API Gateway: $API_NAME (ID: $API_ID)${NC}"
  fi
  
  # Get the root resource ID
  ROOT_ID=$(aws apigateway get-resources \
    --rest-api-id "$API_ID" \
    --region "$AWS_REGION" \
    --query "items[?path=='/'].id" --output text)
    
  echo "Root resource ID: $ROOT_ID"
}

# Function to create authorizer
create_authorizer() {
  echo -e "${BLUE}Setting up JWT Authorizer...${NC}"
  
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
    
    echo -e "${GREEN}Created authorizer with ID: $AUTHORIZER_ID${NC}"
    
    # Add Lambda permission for API Gateway to invoke the authorizer
    aws lambda add-permission \
      --function-name "google-jwt-authorizer" \
      --statement-id "apigateway-authorizer-$API_ID" \
      --action "lambda:InvokeFunction" \
      --principal "apigateway.amazonaws.com" \
      --source-arn "arn:aws:execute-api:$AWS_REGION:$(aws sts get-caller-identity --query Account --output text):$API_ID/*/*" \
      --region "$AWS_REGION" || true
  else
    echo -e "${YELLOW}Using existing authorizer with ID: $AUTHORIZER_ID${NC}"
  fi
}

# Function to create a resource
create_resource() {
  local resource_path=$1
  local parent_id=$2
  
  # Extract path part (last segment of the path)
  local path_part=$(basename "$resource_path")
  
  # Check if resource already exists
  local existing_resource_id=$(aws apigateway get-resources \
    --rest-api-id "$API_ID" \
    --region "$AWS_REGION" \
    --query "items[?path=='$resource_path'].id" --output text)
  
  if [ -z "$existing_resource_id" ] || [ "$existing_resource_id" == "None" ]; then
    echo "Creating resource: $resource_path"
    local resource_id=$(aws apigateway create-resource \
      --rest-api-id "$API_ID" \
      --parent-id "$parent_id" \
      --path-part "$path_part" \
      --region "$AWS_REGION" \
      --query "id" --output text)
    echo -e "${GREEN}Created resource with ID: $resource_id${NC}"
    echo "$resource_id"
  else
    echo -e "${YELLOW}Using existing resource: $resource_path (ID: $existing_resource_id)${NC}"
    echo "$existing_resource_id"
  fi
}

# Function to create method with authorizer
create_method_with_auth() {
  local resource_id=$1
  local http_method=$2
  local lambda_function=$3
  
  # Check if method already exists
  local method_exists=false
  aws apigateway get-method \
    --rest-api-id "$API_ID" \
    --resource-id "$resource_id" \
    --http-method "$http_method" \
    --region "$AWS_REGION" >/dev/null 2>&1 && method_exists=true
  
  if [ "$method_exists" = false ]; then
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
    local lambda_arn=$(aws lambda get-function \
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
      --uri "arn:aws:apigateway:$AWS_REGION:lambda:path/2015-03-31/functions/$lambda_arn/invocations" \
      --region "$AWS_REGION"
    
    # Create method response
    aws apigateway put-method-response \
      --rest-api-id "$API_ID" \
      --resource-id "$resource_id" \
      --http-method "$http_method" \
      --status-code "200" \
      --response-models '{"application/json": "Empty"}' \
      --response-parameters '{"method.response.header.Access-Control-Allow-Origin": true}' \
      --region "$AWS_REGION"
    
    # Add Lambda permission for API Gateway to invoke the function
    local statement_id="apigateway-$API_ID-$resource_id-$http_method-$(date +%s)"
    aws lambda add-permission \
      --function-name "$lambda_function" \
      --statement-id "$statement_id" \
      --action "lambda:InvokeFunction" \
      --principal "apigateway.amazonaws.com" \
      --source-arn "arn:aws:execute-api:$AWS_REGION:$(aws sts get-caller-identity --query Account --output text):$API_ID/*/$http_method/*" \
      --region "$AWS_REGION" || true
    
    echo -e "${GREEN}Created $http_method method with Lambda integration: $lambda_function${NC}"
  else
    echo -e "${YELLOW}Method $http_method already exists for resource ID $resource_id${NC}"
  fi
}

# Function to create OPTIONS method for CORS
create_options_method() {
  local resource_id=$1
  local allowed_methods=$2  # e.g., "GET,POST,PUT,OPTIONS"
  
  # Default allowed methods if not specified
  if [ -z "$allowed_methods" ]; then
    allowed_methods="OPTIONS,GET,POST,PUT"
  fi
  
  # Check if method already exists
  local method_exists=false
  aws apigateway get-method \
    --rest-api-id "$API_ID" \
    --resource-id "$resource_id" \
    --http-method "OPTIONS" \
    --region "$AWS_REGION" >/dev/null 2>&1 && method_exists=true
  
  if [ "$method_exists" = false ]; then
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
    
    # Set up the method response with CORS headers
    aws apigateway put-method-response \
      --rest-api-id "$API_ID" \
      --resource-id "$resource_id" \
      --http-method "OPTIONS" \
      --status-code "200" \
      --response-parameters '{"method.response.header.Access-Control-Allow-Headers": true, "method.response.header.Access-Control-Allow-Methods": true, "method.response.header.Access-Control-Allow-Origin": true}' \
      --response-models '{"application/json": "Empty"}' \
      --region "$AWS_REGION"
    
    # Set up the integration response with CORS headers
    aws apigateway put-integration-response \
      --rest-api-id "$API_ID" \
      --resource-id "$resource_id" \
      --http-method "OPTIONS" \
      --status-code "200" \
      --response-parameters "{\"method.response.header.Access-Control-Allow-Headers\": \"'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token'\", \"method.response.header.Access-Control-Allow-Methods\": \"'$allowed_methods'\", \"method.response.header.Access-Control-Allow-Origin\": \"'*'\"}" \
      --response-templates '{"application/json": ""}' \
      --region "$AWS_REGION"
    
    echo -e "${GREEN}Created OPTIONS method for CORS${NC}"
  else
    echo -e "${YELLOW}OPTIONS method already exists for resource ID $resource_id${NC}"
  fi
}

# Function to configure credentials API
configure_credentials_api() {
  echo -e "${BLUE}Configuring credentials API...${NC}"
  
  # Create resource
  local resource_id=$(create_resource "/credentials" "$ROOT_ID")
  
  # Create methods
  create_method_with_auth "$resource_id" "GET" "get-aws-credentials"
  create_options_method "$resource_id" "OPTIONS,GET"
  
  echo -e "${GREEN}Credentials API configured successfully${NC}"
}

# Function to configure metrics API
configure_metrics_api() {
  echo -e "${BLUE}Configuring user-data-metrics API...${NC}"
  
  # Create resource
  local resource_id=$(create_resource "/user-data-metrics" "$ROOT_ID")
  
  # Create methods
  create_method_with_auth "$resource_id" "GET" "get-user-data-metrics"
  create_options_method "$resource_id" "OPTIONS,GET"
  
  echo -e "${GREEN}User data metrics API configured successfully${NC}"
}

# Function to configure prompt-manager API
configure_prompt_manager_api() {
  echo -e "${BLUE}Configuring prompt-manager API...${NC}"
  
  # Create resource
  local resource_id=$(create_resource "/prompt-manager" "$ROOT_ID")
  
  # Create methods
  create_method_with_auth "$resource_id" "GET" "prompt-manager"
  create_method_with_auth "$resource_id" "POST" "prompt-manager"
  create_method_with_auth "$resource_id" "PUT" "prompt-manager"
  create_options_method "$resource_id" "OPTIONS,GET,POST,PUT"
  
  echo -e "${GREEN}Prompt manager API configured successfully${NC}"
}

# Function to configure user-profile API
configure_user_profile_api() {
  echo -e "${BLUE}Configuring user-profile API...${NC}"
  
  # Create resource
  local resource_id=$(create_resource "/user-profile" "$ROOT_ID")
  
  # Create methods
  create_method_with_auth "$resource_id" "POST" "user-profile-builder"
  create_method_with_auth "$resource_id" "GET" "user-profile-builder"
  create_options_method "$resource_id" "OPTIONS,GET,POST"
  
  echo -e "${GREEN}User profile API configured successfully${NC}"
}

# Function to configure categorize API
configure_categorize_api() {
  echo -e "${BLUE}Configuring categorize API...${NC}"
  
  # Create resource
  local resource_id=$(create_resource "/categorize" "$ROOT_ID")
  
  # Create methods
  create_method_with_auth "$resource_id" "POST" "categorize-user-data"
  create_options_method "$resource_id" "OPTIONS,POST"
  
  echo -e "${GREEN}Categorize API configured successfully${NC}"
}

# Function to deploy the API
deploy_api() {
  echo -e "${BLUE}Deploying API to stage: $STAGE_NAME${NC}"
  
  # Create deployment
  local deployment_id=$(aws apigateway create-deployment \
    --rest-api-id "$API_ID" \
    --stage-name "$STAGE_NAME" \
    --description "Deployed by configure-all-apis.sh script" \
    --region "$AWS_REGION" \
    --query "id" --output text)
  
  echo -e "${GREEN}API deployed successfully to stage: $STAGE_NAME${NC}"
  echo "Deployment ID: $deployment_id"
  
  # Get the API Gateway URL
  local api_url="https://$API_ID.execute-api.$AWS_REGION.amazonaws.com/$STAGE_NAME"
  echo ""
  echo -e "${BLUE}API Gateway Base URL: $api_url${NC}"
  echo "Endpoints:"
  
  if [ "$CONFIGURE_CREDENTIALS" = true ]; then
    echo "- GET $api_url/credentials"
  fi
  
  if [ "$CONFIGURE_METRICS" = true ]; then
    echo "- GET $api_url/user-data-metrics"
  fi
  
  if [ "$CONFIGURE_PROMPT_MANAGER" = true ]; then
    echo "- GET/POST/PUT $api_url/prompt-manager"
  fi
  
  if [ "$CONFIGURE_USER_PROFILE" = true ]; then
    echo "- GET/POST $api_url/user-profile"
  fi
  
  if [ "$CONFIGURE_CATEGORIZE" = true ]; then
    echo "- POST $api_url/categorize"
  fi
  
  echo ""
  echo -e "${GREEN}Add these endpoints to your .env file:${NC}"
  
  if [ "$CONFIGURE_CREDENTIALS" = true ]; then
    echo "REACT_APP_CREDENTIALS_API_URL=$api_url/credentials"
  fi
  
  if [ "$CONFIGURE_METRICS" = true ]; then
    echo "REACT_APP_METRICS_API_URL=$api_url/user-data-metrics"
  fi
  
  if [ "$CONFIGURE_PROMPT_MANAGER" = true ]; then
    echo "REACT_APP_PROMPT_MANAGER_API_URL=$api_url/prompt-manager"
  fi
  
  if [ "$CONFIGURE_USER_PROFILE" = true ]; then
    echo "REACT_APP_USER_PROFILE_API_URL=$api_url/user-profile"
  fi
  
  if [ "$CONFIGURE_CATEGORIZE" = true ]; then
    echo "REACT_APP_CATEGORIZE_API_URL=$api_url/categorize"
  fi
}

# Main execution
echo -e "${BLUE}Digital DNA API Gateway Configuration Tool${NC}"
echo "========================================"
echo "Region: $AWS_REGION"
echo "Stage: $STAGE_NAME"
echo "Deploy after configuration: $DEPLOY"
echo ""

# Check for required Lambda functions
check_lambda_functions

# Create or get the API Gateway
create_or_get_api

# Create authorizer
create_authorizer

# Configure each API as requested
if [ "$CONFIGURE_CREDENTIALS" = true ]; then
  configure_credentials_api
fi

if [ "$CONFIGURE_METRICS" = true ]; then
  configure_metrics_api
fi

if [ "$CONFIGURE_PROMPT_MANAGER" = true ]; then
  configure_prompt_manager_api
fi

if [ "$CONFIGURE_USER_PROFILE" = true ]; then
  configure_user_profile_api
fi

if [ "$CONFIGURE_CATEGORIZE" = true ]; then
  configure_categorize_api
fi

# Deploy if requested
if [ "$DEPLOY" = true ]; then
  deploy_api
else
  echo ""
  echo -e "${YELLOW}API Gateway configuration completed but not deployed.${NC}"
  echo "To deploy the API, run: ./configure-all-apis.sh --deploy"
fi

echo ""
echo -e "${GREEN}Configuration completed successfully!${NC}"