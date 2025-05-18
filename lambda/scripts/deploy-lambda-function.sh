#!/bin/bash
# Simple script to deploy a single Lambda function

# Check for Lambda name
if [ -z "$1" ]; then
  echo "Usage: ./deploy-lambda-function.sh <function-name>"
  exit 1
fi

FUNCTION_NAME=$1
REGION=${AWS_REGION:-"us-east-1"}
S3_BUCKET_NAME=${S3_BUCKET_NAME:-"dee-en-eh-bucket"}

echo "Deploying $FUNCTION_NAME to AWS Lambda..."

# Build the Lambda function
echo "Building Lambda package..."
mkdir -p dist
zip -r "dist/$FUNCTION_NAME.zip" "$FUNCTION_NAME.js" node_modules

# Check if function exists
if aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" >/dev/null 2>&1; then
  echo "Function exists, updating..."
  
  # Update function code
  aws lambda update-function-code \
    --function-name "$FUNCTION_NAME" \
    --zip-file "fileb://dist/$FUNCTION_NAME.zip" \
    --region "$REGION"
  
  echo "Lambda function $FUNCTION_NAME updated successfully!"
else
  echo "Function doesn't exist, please create it first with:"
  echo "./deploy.sh $FUNCTION_NAME --create"
  exit 1
fi