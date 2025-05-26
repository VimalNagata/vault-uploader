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
  echo "Function doesn't exist, please create it first with:"
  echo "./deploy.sh $FUNCTION_NAME --create"
  exit 1
fi