#!/bin/bash
# Master deployment script for Digital DNA Lambda functions
#
# This script provides a unified interface for deploying all Lambda functions
# in the Digital DNA application.

set -e  # Exit immediately if a command exits with a non-zero status

# Directory where the script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Default values
LAMBDA_FUNCTION=""
ACTION="update"
STAGE="prod"
CREATE_API=false
DEPLOY_API=false
REGION=${AWS_REGION:-"us-east-1"}
S3_BUCKET_NAME=${S3_BUCKET_NAME:-""}
OPENAI_API_KEY=${OPENAI_API_KEY:-""}
LAMBDA_ROLE_ARN=${LAMBDA_ROLE_ARN:-""}

# Display help message
function show_help() {
  echo "Digital DNA Lambda Deployment Tool"
  echo "=================================="
  echo ""
  echo "Usage: ./deploy.sh [options] <function-name>"
  echo ""
  echo "Function Names:"
  echo "  all                          Deploy all Lambda functions"
  echo "  pipeline                     Deploy the full data processing pipeline"
  echo "  auth                         Deploy authentication Lambdas (get-aws-credentials and google-jwt-authorizer)"
  echo "  metrics                      Deploy get-user-data-metrics"
  echo "  categorize                   Deploy categorize-user-data"
  echo "  preprocessor                 Deploy data-preprocessor"
  echo "  orchestrator                 Deploy data-processing-orchestrator"
  echo "  persona-builder              Deploy persona-builder"
  echo "  <specific-function-name>     Deploy a specific Lambda function"
  echo ""
  echo "Options:"
  echo "  --create                     Create a new Lambda function (default: update existing)"
  echo "  --configure-api              Configure API Gateway for the function"
  echo "  --deploy-api                 Deploy API Gateway after configuration"
  echo "  --stage <stage-name>         Stage name for API deployment (default: prod)"
  echo "  --region <region>            AWS region (default: us-east-1 or AWS_REGION env var)"
  echo "  --bucket <bucket-name>       S3 bucket name (overrides S3_BUCKET_NAME env var)"
  echo "  --role <role-arn>            Lambda execution role ARN (overrides LAMBDA_ROLE_ARN env var)"
  echo "  --help                       Show this help message"
  echo ""
  echo "Environment Variables:"
  echo "  AWS_REGION                   AWS region to deploy to"
  echo "  S3_BUCKET_NAME               S3 bucket name for user data storage"
  echo "  OPENAI_API_KEY               OpenAI API key (required for categorization and persona functions)"
  echo "  LAMBDA_ROLE_ARN              Default IAM role ARN for Lambda functions"
  echo ""
  echo "Examples:"
  echo "  ./deploy.sh get-user-data-metrics                 Update the metrics Lambda"
  echo "  ./deploy.sh orchestrator --create                 Create the orchestrator Lambda"
  echo "  ./deploy.sh all --configure-api --deploy-api      Update all Lambdas and deploy API Gateway"
  echo "  ./deploy.sh pipeline                              Deploy the full data processing pipeline"
  echo "  ./deploy.sh auth --configure-api --deploy-api     Deploy auth Lambdas with API Gateway"
  echo ""
}

# Parse command-line arguments
if [[ $# -eq 0 ]]; then
  show_help
  exit 0
fi

POSITIONAL_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --create)
      ACTION="create"
      shift
      ;;
    --configure-api)
      CREATE_API=true
      shift
      ;;
    --deploy-api)
      DEPLOY_API=true
      shift
      ;;
    --stage)
      STAGE="$2"
      shift 2
      ;;
    --region)
      REGION="$2"
      shift 2
      ;;
    --bucket)
      S3_BUCKET_NAME="$2"
      shift 2
      ;;
    --role)
      LAMBDA_ROLE_ARN="$2"
      shift 2
      ;;
    --help)
      show_help
      exit 0
      ;;
    -*)
      echo "Unknown option: $1"
      show_help
      exit 1
      ;;
    *)
      POSITIONAL_ARGS+=("$1")
      shift
      ;;
  esac
done

# Restore positional arguments
set -- "${POSITIONAL_ARGS[@]}"

# Get function name from first positional argument
LAMBDA_FUNCTION="$1"

# Check if the function name is valid
if [[ -z "$LAMBDA_FUNCTION" ]]; then
  echo "Error: Function name is required."
  show_help
  exit 1
fi

# Verify required environment variables
if [[ -z "$S3_BUCKET_NAME" ]]; then
  echo "Warning: S3_BUCKET_NAME environment variable is not set."
  echo "Please set it with: export S3_BUCKET_NAME=your-bucket-name"
  echo "Or use the --bucket option."
  
  # Try to find a suitable bucket
  DETECTED_BUCKET=$(aws s3api list-buckets --query "Buckets[?contains(Name, 'ccpa') || contains(Name, 'gdpr') || contains(Name, 'userdata')].Name | [0]" --output text --region "$REGION")
  
  if [[ -n "$DETECTED_BUCKET" && "$DETECTED_BUCKET" != "None" ]]; then
    echo "Detected potential S3 bucket: $DETECTED_BUCKET"
    read -p "Use this bucket? (y/n): " USE_DETECTED
    if [[ "$USE_DETECTED" == "y" ]]; then
      S3_BUCKET_NAME="$DETECTED_BUCKET"
    else
      read -p "Enter S3 bucket name: " S3_BUCKET_NAME
    fi
  else
    read -p "Enter S3 bucket name: " S3_BUCKET_NAME
  fi
  
  if [[ -z "$S3_BUCKET_NAME" ]]; then
    echo "Error: S3 bucket name is required."
    exit 1
  fi
fi

echo "Using S3 bucket: $S3_BUCKET_NAME"
echo "Using AWS region: $REGION"

# Function to check if a Lambda function exists
function_exists() {
  local function_name="$1"
  aws lambda get-function --function-name "$function_name" --region "$REGION" >/dev/null 2>&1
  return $?
}

# Function to build a Lambda package
build_lambda() {
  local function_name="$1"
  
  echo "Building Lambda package for $function_name..."
  
  # Look for the Lambda file in the parent directory of the script directory
  local LAMBDA_DIR="$(dirname "$SCRIPT_DIR")"
  
  if [[ ! -f "$LAMBDA_DIR/$function_name.js" ]]; then
    # Try in the script directory as a fallback
    if [[ ! -f "$SCRIPT_DIR/$function_name.js" ]]; then
      echo "Error: Lambda function file $function_name.js not found in either $LAMBDA_DIR or $SCRIPT_DIR."
      return 1
    else
      LAMBDA_DIR="$SCRIPT_DIR"
    fi
  fi
  
  echo "Found Lambda function file at: $LAMBDA_DIR/$function_name.js"
  
  # Create dist directory if it doesn't exist
  mkdir -p "$SCRIPT_DIR/dist"
  
  # Create temp directory for building
  local temp_dir="$SCRIPT_DIR/temp_$function_name"
  mkdir -p "$temp_dir"
  
  # Copy Lambda file
  cp "$LAMBDA_DIR/$function_name.js" "$temp_dir/"
  
  # Create package.json for the Lambda
  cat > "$temp_dir/package.json" <<EOL
{
  "name": "$function_name",
  "version": "1.0.0",
  "main": "$function_name.js",
  "dependencies": {
    "aws-sdk": "^2.1469.0"
  }
}
EOL
  
  # For specific functions, add extra dependencies
  if [[ "$function_name" == "google-jwt-authorizer" ]]; then
    echo "Adding Google Auth dependencies for $function_name..."
    cat > "$temp_dir/package.json" <<EOL
{
  "name": "$function_name",
  "version": "1.0.0",
  "main": "$function_name.js",
  "dependencies": {
    "google-auth-library": "^8.7.0"
  }
}
EOL
  elif [[ "$function_name" == "data-preprocessor" ]]; then
    echo "Adding PDF-parse dependencies for $function_name..."
    cat > "$temp_dir/package.json" <<EOL
{
  "name": "$function_name",
  "version": "1.0.0",
  "main": "$function_name.js",
  "dependencies": {
    "aws-sdk": "^2.1469.0",
    "pdf-parse": "^1.1.1"
  }
}
EOL
  fi
  
  # Install dependencies
  echo "Installing dependencies for $function_name..."
  (cd "$temp_dir" && npm install --production --silent)
  
  # Create zip file
  echo "Creating zip file for $function_name..."
  (cd "$temp_dir" && zip -q -r "../dist/$function_name.zip" .)
  
  # Clean up
  rm -rf "$temp_dir"
  
  echo "Lambda package built successfully: dist/$function_name.zip ($(du -h "dist/$function_name.zip" | cut -f1) compressed)"
}

# Function to check if a Lambda function requires OpenAI
needs_openai() {
  local function_name="$1"
  if [[ "$function_name" == "categorize-user-data" || "$function_name" == "persona-builder" || "$function_name" == "data-preprocessor" ]]; then
    return 0  # true
  else
    return 1  # false
  fi
}

# Function to deploy a Lambda function
deploy_lambda() {
  local function_name="$1"
  local action="$2"
  local role_arn="$LAMBDA_ROLE_ARN"
  
  # Build Lambda package
  build_lambda "$function_name"
  
  # Check if we need OpenAI API key
  if needs_openai "$function_name"; then
    if [[ -z "$OPENAI_API_KEY" ]]; then
      echo "Warning: OPENAI_API_KEY environment variable is not set."
      echo "This is required for $function_name."
      read -s -p "Enter OpenAI API key: " OPENAI_API_KEY
      echo ""
      if [[ -z "$OPENAI_API_KEY" ]]; then
        echo "Error: OpenAI API key is required for $function_name."
        return 1
      fi
    fi
  fi
  
  # If no role ARN provided, try to find a suitable role or ask for one
  if [[ -z "$role_arn" ]]; then
    # Try to find a role with a suitable name
    local role_name="lambda-$function_name-role"
    role_arn=$(aws iam get-role --role-name "$role_name" --query "Role.Arn" --output text --region "$REGION" 2>/dev/null)
    
    if [[ -z "$role_arn" || "$role_arn" == "None" ]]; then
      role_name="LambdaCCPAProcessor"
      role_arn=$(aws iam get-role --role-name "$role_name" --query "Role.Arn" --output text --region "$REGION" 2>/dev/null)
    fi
    
    if [[ -z "$role_arn" || "$role_arn" == "None" ]]; then
      echo "No suitable Lambda execution role found."
      read -p "Enter Lambda execution role ARN: " role_arn
      
      if [[ -z "$role_arn" ]]; then
        echo "Error: Lambda execution role ARN is required."
        return 1
      fi
    fi
  fi
  
  echo "Using Lambda execution role: $role_arn"
  
  # Prepare environment variables
  local env_vars="{\"Variables\":{\"S3_BUCKET_NAME\":\"$S3_BUCKET_NAME\"}}"
  
  if needs_openai "$function_name"; then
    env_vars="{\"Variables\":{\"S3_BUCKET_NAME\":\"$S3_BUCKET_NAME\",\"OPENAI_API_KEY\":\"$OPENAI_API_KEY\"}}"
  fi
  
  if [[ "$function_name" == "google-jwt-authorizer" ]]; then
    # For JWT authorizer, check if we have a Google client ID
    if [[ -z "$GOOGLE_CLIENT_ID" ]]; then
      echo "Warning: GOOGLE_CLIENT_ID environment variable is not set."
      read -p "Enter Google Client ID: " GOOGLE_CLIENT_ID
      if [[ -z "$GOOGLE_CLIENT_ID" ]]; then
        echo "Error: Google Client ID is required for google-jwt-authorizer."
        return 1
      fi
    fi
    
    env_vars="{\"Variables\":{\"GOOGLE_CLIENT_ID\":\"$GOOGLE_CLIENT_ID\"}}"
  fi
  
  # Deploy Lambda function
  if [[ "$action" == "create" ]]; then
    # Check if the function already exists
    if function_exists "$function_name"; then
      echo "Error: Lambda function $function_name already exists."
      echo "Use --update or omit the --create flag to update it."
      return 1
    fi
    
    echo "Creating Lambda function: $function_name..."
    
    CREATE_RESULT=$(aws lambda create-function \
      --function-name "$function_name" \
      --runtime nodejs18.x \
      --handler "$function_name.handler" \
      --role "$role_arn" \
      --zip-file "fileb://dist/$function_name.zip" \
      --timeout 60 \
      --memory-size 256 \
      --environment "$env_vars" \
      --region "$REGION" \
      --query 'FunctionArn' \
      --output text)
    
    echo "✅ Lambda function $function_name created successfully!"
    echo "ARN: $CREATE_RESULT"
  else
    # Check if the function exists
    if ! function_exists "$function_name"; then
      echo "Error: Lambda function $function_name does not exist."
      echo "Use --create to create it."
      return 1
    fi
    
    echo "Updating Lambda function: $function_name..."
    
    # Update function code
    echo "Uploading code to AWS Lambda..."
    UPDATE_RESULT=$(aws lambda update-function-code \
      --function-name "$function_name" \
      --zip-file "fileb://dist/$function_name.zip" \
      --region "$REGION" \
      --query 'LastModified' \
      --output text)
    
    # Update configuration
    echo "Updating Lambda configuration..."
    aws lambda update-function-configuration \
      --function-name "$function_name" \
      --timeout 60 \
      --memory-size 256 \
      --environment "$env_vars" \
      --region "$REGION" > /dev/null
    
    echo "✅ Lambda function $function_name successfully updated at: $UPDATE_RESULT"
  fi
  
  return 0
}

# Function to deploy API Gateway
deploy_api_gateway() {
  if [[ "$CREATE_API" == true ]]; then
    echo "Configuring API Gateway..."
    
    local deploy_flag=""
    if [[ "$DEPLOY_API" == true ]]; then
      deploy_flag="--deploy --stage $STAGE"
    fi
    
    # Configure API Gateway
    "$SCRIPT_DIR/configure-api-gateway.sh" $deploy_flag
    
    # If categorize function was deployed, also configure its API endpoint
    if [[ -f "$SCRIPT_DIR/configure-categorize-api.sh" && (
           "$LAMBDA_FUNCTION" == "all" || 
           "$LAMBDA_FUNCTION" == "pipeline" || 
           "$LAMBDA_FUNCTION" == "categorize" ||
           "$LAMBDA_FUNCTION" == "categorize-user-data"
         ) ]]; then
      echo "Configuring categorize API endpoint..."
      "$SCRIPT_DIR/configure-categorize-api.sh" $deploy_flag
    fi
  elif [[ "$DEPLOY_API" == true ]]; then
    echo "Error: Cannot deploy API without configuring it first."
    echo "Use --configure-api --deploy-api to configure and deploy API Gateway."
    return 1
  fi
}

# Function to deploy all Lambda functions
deploy_all() {
  local action="$1"
  
  echo "Deploying all Lambda functions..."
  
  # Authentication Lambdas
  deploy_lambda "get-aws-credentials" "$action"
  deploy_lambda "google-jwt-authorizer" "$action"
  
  # Metrics Lambda
  deploy_lambda "get-user-data-metrics" "$action"
  
  # Data processing pipeline
  deploy_lambda "data-processing-orchestrator" "$action"
  deploy_lambda "data-preprocessor" "$action"
  deploy_lambda "categorize-user-data" "$action"
  deploy_lambda "persona-builder" "$action"
  
  # Configure and potentially deploy API Gateway
  deploy_api_gateway
}

# Function to deploy authentication Lambdas
deploy_auth() {
  local action="$1"
  
  echo "Deploying authentication Lambda functions..."
  
  # Authentication Lambdas
  deploy_lambda "get-aws-credentials" "$action"
  deploy_lambda "google-jwt-authorizer" "$action"
  
  # Configure and potentially deploy API Gateway
  deploy_api_gateway
}

# Function to deploy the data processing pipeline
deploy_pipeline() {
  local action="$1"
  
  echo "Deploying data processing pipeline Lambda functions..."
  
  # Data processing pipeline
  deploy_lambda "data-processing-orchestrator" "$action"
  deploy_lambda "data-preprocessor" "$action"
  deploy_lambda "categorize-user-data" "$action"
  deploy_lambda "persona-builder" "$action"
  
  # Configure S3 event notifications
  if [[ "$action" == "create" || ! -f "$SCRIPT_DIR/s3-event-trigger.json" ]]; then
    echo "Creating S3 event notification configuration..."
    
    # Get Lambda ARN
    ORCHESTRATOR_ARN=$(aws lambda get-function --function-name "data-processing-orchestrator" --query "Configuration.FunctionArn" --output text --region "$REGION")
    
    # Create notification configuration
    cat > "$SCRIPT_DIR/s3-event-trigger.json" <<EOL
{
  "LambdaFunctionConfigurations": [
    {
      "Id": "TriggerDataProcessingOrchestrator",
      "LambdaFunctionArn": "$ORCHESTRATOR_ARN",
      "Events": ["s3:ObjectCreated:*"],
      "Filter": {
        "Key": {
          "FilterRules": [
            {
              "Name": "prefix",
              "Value": "*/"
            }
          ]
        }
      }
    }
  ]
}
EOL
  fi
  
  # Ask before applying S3 event notification
  read -p "Apply S3 event notification to trigger the pipeline? (y/n): " APPLY_NOTIFICATION
  
  if [[ "$APPLY_NOTIFICATION" == "y" ]]; then
    echo "Applying S3 event notification..."
    
    # Give S3 permission to invoke Lambda
    aws lambda add-permission \
      --function-name "data-processing-orchestrator" \
      --statement-id "s3-permission" \
      --action "lambda:InvokeFunction" \
      --principal "s3.amazonaws.com" \
      --source-arn "arn:aws:s3:::$S3_BUCKET_NAME" \
      --source-account "$(aws sts get-caller-identity --query Account --output text)" \
      --region "$REGION" || echo "Permission may already exist"
    
    # Apply notification configuration
    aws s3api put-bucket-notification-configuration \
      --bucket "$S3_BUCKET_NAME" \
      --notification-configuration file://"$SCRIPT_DIR/s3-event-trigger.json" \
      --region "$REGION"
    
    echo "S3 event notification applied successfully."
  else
    echo "Skipping S3 event notification setup."
  fi
}

# Main execution
case "$LAMBDA_FUNCTION" in
  "all")
    deploy_all "$ACTION"
    ;;
  "auth")
    deploy_auth "$ACTION"
    ;;
  "pipeline")
    deploy_pipeline "$ACTION"
    ;;
  "metrics")
    deploy_lambda "get-user-data-metrics" "$ACTION"
    deploy_api_gateway
    ;;
  "categorize")
    deploy_lambda "categorize-user-data" "$ACTION"
    ;;
  "preprocessor")
    deploy_lambda "data-preprocessor" "$ACTION"
    ;;
  "orchestrator")
    deploy_lambda "data-processing-orchestrator" "$ACTION"
    ;;
  "persona-builder")
    deploy_lambda "persona-builder" "$ACTION"
    ;;
  *)
    # Deploy a specific Lambda function
    deploy_lambda "$LAMBDA_FUNCTION" "$ACTION"
    ;;
esac

# Final summary
echo ""
echo "Deployment completed."
echo ""
echo "Next steps:"
if [[ "$CREATE_API" == true && "$DEPLOY_API" == true ]]; then
  echo "1. Update your frontend configuration to use the new API Gateway endpoints"
elif [[ "$CREATE_API" == true && "$DEPLOY_API" != true ]]; then
  echo "1. Deploy the API Gateway: ./deploy.sh --deploy-api"
  echo "2. Update your frontend configuration to use the new API Gateway endpoints"
else
  echo "1. Configure API Gateway: ./deploy.sh --configure-api"
  echo "2. Deploy the API Gateway: ./deploy.sh --deploy-api"
  echo "3. Update your frontend configuration to use the new API Gateway endpoints"
fi