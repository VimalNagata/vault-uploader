#!/bin/bash
# Script to deploy a single Lambda function via S3

# Check for Lambda name
if [ -z "$1" ]; then
  echo "Usage: ./deploy-lambda-function.sh <function-name>"
  exit 1
fi

FUNCTION_NAME=$1
REGION=${AWS_REGION:-"us-east-1"}
S3_BUCKET_NAME=${S3_BUCKET_NAME:-"dee-en-eh-bucket"}
S3_KEY="lambdas/dist/$FUNCTION_NAME.zip"

echo "Deploying $FUNCTION_NAME to AWS Lambda..."

# Build the Lambda function
echo "Building Lambda package..."
mkdir -p dist

# Special handling for data-preprocessor to include pdf-parse
if [ "$FUNCTION_NAME" == "data-preprocessor" ]; then
  echo "Including pdf-parse module for data-preprocessor..."
  zip -r "dist/$FUNCTION_NAME.zip" "$FUNCTION_NAME.js" node_modules/pdf-parse node_modules/node-ensure
else
  zip -r "dist/$FUNCTION_NAME.zip" "$FUNCTION_NAME.js" node_modules
fi

# Upload to S3
echo "Uploading to S3 bucket $S3_BUCKET_NAME/$S3_KEY..."
aws s3 cp "dist/$FUNCTION_NAME.zip" "s3://$S3_BUCKET_NAME/$S3_KEY" --region "$REGION"

# Check if function exists
if aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" >/dev/null 2>&1; then
  echo "Function exists, updating..."
  
  # Update function code from S3
  echo "Updating Lambda from S3..."
  aws lambda update-function-code \
    --function-name "$FUNCTION_NAME" \
    --s3-bucket "$S3_BUCKET_NAME" \
    --s3-key "$S3_KEY" \
    --region "$REGION"
  
  echo "Lambda function $FUNCTION_NAME updated successfully!"
else
  echo "Function doesn't exist, creating it now..."
  
  # Always prompt for S3 bucket name when creating a Lambda
  if [ -z "$S3_BUCKET_NAME" ]; then
    echo "S3 bucket name is required."
    read -p "S3 bucket name: " S3_BUCKET_NAME
  else
    echo "Current S3 bucket name: $S3_BUCKET_NAME"
    read -p "Use this bucket? [Y/n]: " USE_CURRENT_BUCKET
    if [[ "$USE_CURRENT_BUCKET" == "n" || "$USE_CURRENT_BUCKET" == "N" ]]; then
      read -p "S3 bucket name: " S3_BUCKET_NAME
    fi
  fi
  
  if [ -z "$S3_BUCKET_NAME" ]; then
    echo "Error: S3 bucket name is required."
    exit 1
  fi
  
  # Get default Lambda role for suggestion
  DEFAULT_ROLE=$(aws iam list-roles --query "Roles[?contains(RoleName, 'Lambda') || contains(RoleName, 'lambda')].Arn" --output text --region "$REGION" | head -n 1)
  
  # If no Lambda role found, try to get any role
  if [ -z "$DEFAULT_ROLE" ]; then
    DEFAULT_ROLE=$(aws iam list-roles --query "Roles[0].Arn" --output text --region "$REGION")
  fi
  
  # Always prompt for role ARN
  if [ -n "$DEFAULT_ROLE" ]; then
    echo "Found default IAM role: $DEFAULT_ROLE"
    read -p "Use this role? [Y/n]: " USE_DEFAULT_ROLE
    if [[ "$USE_DEFAULT_ROLE" == "n" || "$USE_DEFAULT_ROLE" == "N" ]]; then
      read -p "Role ARN: " LAMBDA_ROLE_ARN
    else
      LAMBDA_ROLE_ARN="$DEFAULT_ROLE"
    fi
  else
    echo "No default IAM role found. Please provide a role ARN for Lambda execution:"
    read -p "Role ARN: " LAMBDA_ROLE_ARN
  fi
  
  if [ -z "$LAMBDA_ROLE_ARN" ]; then
    echo "Error: Lambda execution role ARN is required."
    exit 1
  fi
  
  # Prepare environment variables
  ENV_VARS="{\"Variables\":{\"S3_BUCKET_NAME\":\"$S3_BUCKET_NAME\"}}"
  
  # Always prompt for OpenAI API key for functions that need it
  if [ "$FUNCTION_NAME" == "categorize-user-data" -o "$FUNCTION_NAME" == "persona-builder" -o "$FUNCTION_NAME" == "data-preprocessor" ]; then
    if [ -n "$OPENAI_API_KEY" ]; then
      echo "Current OpenAI API key: ${OPENAI_API_KEY:0:5}..."
      read -p "Use this API key? [Y/n]: " USE_CURRENT_KEY
      if [[ "$USE_CURRENT_KEY" == "n" || "$USE_CURRENT_KEY" == "N" ]]; then
        read -s -p "OpenAI API key: " OPENAI_API_KEY
        echo
      fi
    else
      read -s -p "OpenAI API key: " OPENAI_API_KEY
      echo
    fi
    
    if [ -n "$OPENAI_API_KEY" ]; then
      ENV_VARS="{\"Variables\":{\"S3_BUCKET_NAME\":\"$S3_BUCKET_NAME\",\"OPENAI_API_KEY\":\"$OPENAI_API_KEY\"}}"
    fi
  fi
  
  # Create the Lambda function
  echo "Creating Lambda function: $FUNCTION_NAME..."
  aws lambda create-function \
    --function-name "$FUNCTION_NAME" \
    --runtime nodejs18.x \
    --handler "$FUNCTION_NAME.handler" \
    --role "$LAMBDA_ROLE_ARN" \
    --code "S3Bucket=$S3_BUCKET_NAME,S3Key=$S3_KEY" \
    --timeout 60 \
    --memory-size 256 \
    --environment "$ENV_VARS" \
    --region "$REGION"
  
  # Configure the Lambda function for API Gateway
  echo "Adding API Gateway permission..."
  aws lambda add-permission \
    --function-name "$FUNCTION_NAME" \
    --statement-id "apigateway-invoke-$FUNCTION_NAME" \
    --action "lambda:InvokeFunction" \
    --principal "apigateway.amazonaws.com" \
    --region "$REGION" || echo "Note: API Gateway permission may already exist"
  
  echo "Lambda function $FUNCTION_NAME created successfully!"
fi