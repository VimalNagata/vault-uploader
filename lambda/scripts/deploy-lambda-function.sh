#!/bin/bash
# Script to deploy a single Lambda function, with support for optimized packages and S3 deployment

# Check for Lambda name
if [ -z "$1" ]; then
  echo "Usage: ./deploy-lambda-function.sh <function-name> [--optimized] [--s3]"
  exit 1
fi

FUNCTION_NAME=$1
OPTIMIZED=false
USE_S3=false
# Parse arguments
for arg in "$@"
do
  if [ "$arg" == "--optimized" ]; then
    OPTIMIZED=true
  elif [ "$arg" == "--s3" ]; then
    USE_S3=true
  fi
done

REGION=${AWS_REGION:-"us-east-1"}
S3_BUCKET_NAME=${S3_BUCKET_NAME:-"dee-en-eh-bucket"}
S3_KEY="lambda-functions/$FUNCTION_NAME.zip"

echo "Deploying $FUNCTION_NAME to AWS Lambda..."

# Build the Lambda function if not using optimized package
if [ "$OPTIMIZED" == "false" ]; then
  echo "Building Lambda package..."
  mkdir -p dist
  
  # Special handling for data-preprocessor to include pdf-parse
  if [ "$FUNCTION_NAME" == "data-preprocessor" ]; then
    echo "Including pdf-parse module for data-preprocessor..."
    zip -r "dist/$FUNCTION_NAME.zip" "$FUNCTION_NAME.js" node_modules/pdf-parse node_modules/node-ensure
  else
    zip -r "dist/$FUNCTION_NAME.zip" "$FUNCTION_NAME.js" node_modules
  fi
  ZIP_PATH="dist/$FUNCTION_NAME.zip"
else
  echo "Using optimized package from ../dist/$FUNCTION_NAME-optimized.zip"
  # Make sure parent dist directory exists
  mkdir -p ../dist
  ZIP_PATH="../dist/$FUNCTION_NAME-optimized.zip"
  S3_KEY="lambda-functions/$FUNCTION_NAME-optimized.zip"
fi

# Check if function exists
if aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" >/dev/null 2>&1; then
  echo "Function exists, updating..."
  
  # If using S3, upload the ZIP file first
  if [ "$USE_S3" == "true" ]; then
    echo "Uploading to S3 bucket $S3_BUCKET_NAME/$S3_KEY..."
    aws s3 cp "$ZIP_PATH" "s3://$S3_BUCKET_NAME/$S3_KEY" --region "$REGION"
    
    # Update function code from S3
    echo "Updating Lambda from S3..."
    aws lambda update-function-code \
      --function-name "$FUNCTION_NAME" \
      --s3-bucket "$S3_BUCKET_NAME" \
      --s3-key "$S3_KEY" \
      --region "$REGION"
  else
    # Update function code directly with local ZIP file
    echo "Updating Lambda with local ZIP file..."
    aws lambda update-function-code \
      --function-name "$FUNCTION_NAME" \
      --zip-file "fileb://$ZIP_PATH" \
      --region "$REGION"
  fi
  
  echo "Lambda function $FUNCTION_NAME updated successfully!"
else
  echo "Function doesn't exist, please create it first with:"
  echo "./deploy.sh $FUNCTION_NAME --create"
  exit 1
fi