#!/bin/bash
# deploy-lambda-all.sh
#
# Script to build and deploy all Lambda functions in the project
# This script can be run from any directory and will work correctly

set -e  # Exit immediately if a command exits with a non-zero status

# Get the directory where the Lambda functions are located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAMBDA_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== Digital DNA Lambda Deployment ==="
echo "Script directory: $SCRIPT_DIR"
echo "Lambda directory: $LAMBDA_DIR"
echo ""

# Check for AWS CLI
if ! command -v aws &> /dev/null; then
    echo "Error: AWS CLI is not installed or not in PATH."
    echo "Please install the AWS CLI before running this script."
    exit 1
fi

# Parse command-line arguments
CREATE_FLAG=""
CONFIGURE_API=false
DEPLOY_API=false
STAGE="prod"
REGION=${AWS_REGION:-"us-east-1"}
S3_BUCKET_NAME=${S3_BUCKET_NAME:-""}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --create)
      CREATE_FLAG="--create"
      shift
      ;;
    --configure-api)
      CONFIGURE_API=true
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
    --help)
      echo "Usage: ./deploy-lambda-all.sh [options]"
      echo ""
      echo "Options:"
      echo "  --create                  Create new Lambda functions (default: update existing)"
      echo "  --configure-api           Configure API Gateway for the functions"
      echo "  --deploy-api              Deploy API Gateway after configuration"
      echo "  --stage <stage-name>      Stage name for API deployment (default: prod)"
      echo "  --region <region>         AWS region (default: us-east-1 or AWS_REGION env var)"
      echo "  --bucket <bucket-name>    S3 bucket name (overrides S3_BUCKET_NAME env var)"
      echo "  --help                    Show this help message"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      echo "Use --help for usage information"
      exit 1
      ;;
  esac
done

# Set bucket name if provided
BUCKET_FLAG=""
if [[ -n "$S3_BUCKET_NAME" ]]; then
  BUCKET_FLAG="--bucket $S3_BUCKET_NAME"
fi

# Set region flag
REGION_FLAG="--region $REGION"

# Set API flags
API_FLAGS=""
if [[ "$CONFIGURE_API" == true ]]; then
  API_FLAGS="$API_FLAGS --configure-api"
fi
if [[ "$DEPLOY_API" == true ]]; then
  API_FLAGS="$API_FLAGS --deploy-api"
fi
if [[ -n "$STAGE" && "$STAGE" != "prod" ]]; then
  API_FLAGS="$API_FLAGS --stage $STAGE"
fi

# Get list of Lambda function names from JS files in the Lambda directory
echo "Scanning for Lambda functions in $LAMBDA_DIR..."

# Find all JS files in the lambda directory
LAMBDA_FILES=$(find "$LAMBDA_DIR" -maxdepth 1 -name "*.js" -type f -exec basename {} \; | sort)

# Build the list of function names without the .js extension
LAMBDA_FUNCTIONS=()
for file in $LAMBDA_FILES; do
  func_name="${file%.js}"
  LAMBDA_FUNCTIONS+=("$func_name")
done

if [[ ${#LAMBDA_FUNCTIONS[@]} -eq 0 ]]; then
  echo "Error: No Lambda functions found in $LAMBDA_DIR"
  exit 1
fi

echo "Found ${#LAMBDA_FUNCTIONS[@]} Lambda functions:"
for func in "${LAMBDA_FUNCTIONS[@]}"; do
  echo "  - $func"
done
echo ""

# Deploy each Lambda function
echo "Starting deployment of all Lambda functions..."
echo ""

for func in "${LAMBDA_FUNCTIONS[@]}"; do
  echo "====================================================================="
  echo "Deploying Lambda function: $func"
  echo "====================================================================="
  
  # Use the deploy.sh script
  "$SCRIPT_DIR/deploy.sh" $func $CREATE_FLAG $REGION_FLAG $BUCKET_FLAG $API_FLAGS
  
  # Check the result
  if [[ $? -eq 0 ]]; then
    echo "Successfully deployed Lambda function: $func"
  else
    echo "⚠️ Error deploying Lambda function: $func"
    # Continue with other functions even if one fails
  fi
  
  echo ""
done

echo "====================================================================="
echo "Deployment of all Lambda functions completed!"
echo "====================================================================="

# Configure API Gateway if requested
if [[ "$CONFIGURE_API" == true || "$DEPLOY_API" == true ]]; then
  echo ""
  echo "Setting up API Gateway..."
  
  # Call deploy.sh with the "all" parameter to ensure API Gateway is configured correctly
  "$SCRIPT_DIR/deploy.sh" all $REGION_FLAG $BUCKET_FLAG $API_FLAGS
  
  if [[ "$DEPLOY_API" == true ]]; then
    echo ""
    echo "API Gateway deployment completed!"
    echo "API Base URL can be found in the AWS console under API Gateway > APIs > DigitalDNA API"
  else
    echo ""
    echo "API Gateway configuration completed!"
    echo "To deploy the API, run: ./deploy.sh --deploy-api"
  fi
fi

echo ""
echo "✅ All functions processed!"
echo ""
echo "The following Lambda functions were processed:"
for func in "${LAMBDA_FUNCTIONS[@]}"; do
  echo "  - $func"
done