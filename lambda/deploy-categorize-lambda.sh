#!/bin/bash
# Script to deploy the categorize-user-data Lambda function with S3 trigger

set -e  # Exit immediately if a command exits with a non-zero status

# Check for OpenAI API key
if [ -z "$OPENAI_API_KEY" ]; then
  echo "Error: OPENAI_API_KEY environment variable is required."
  echo "Please set it with: export OPENAI_API_KEY=your-openai-api-key"
  exit 1
fi

# Check for S3 bucket name
if [ -z "$S3_BUCKET_NAME" ]; then
  echo "Error: S3_BUCKET_NAME environment variable is required."
  echo "Please set it with: export S3_BUCKET_NAME=your-bucket-name"
  exit 1
fi

# Set AWS region (can be overridden with environment variable)
AWS_REGION=${AWS_REGION:-"us-east-1"}

echo "Deploying categorize-user-data Lambda function..."

# Step 1: Build and deploy the Lambda function
echo "Building Lambda package..."
./build-lambdas.sh

# Check if Lambda function already exists
echo "Checking if Lambda function already exists..."
if aws lambda get-function --function-name categorize-user-data --region $AWS_REGION >/dev/null 2>&1; then
  echo "Lambda function exists, updating it..."
  
  # Update the function
  ./deploy-lambda.sh categorize-user-data
else
  echo "Lambda function does not exist, creating it..."
  
  # Create the function
  ./deploy-lambda.sh categorize-user-data --create
fi

# Step 2: Set up API Gateway endpoint
echo "Configuring API Gateway..."
./configure-categorize-api.sh --deploy

# Step 3: Add permission for S3 to invoke Lambda
echo "Adding permission for S3 to invoke Lambda..."
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query 'Account' --output text)

# Add Lambda permission for S3 invocation (will fail if already exists, which is okay)
aws lambda add-permission \
  --function-name categorize-user-data \
  --principal s3.amazonaws.com \
  --statement-id S3InvokePermission \
  --action "lambda:InvokeFunction" \
  --source-arn "arn:aws:s3:::$S3_BUCKET_NAME" \
  --region $AWS_REGION || echo "Permission may already exist"

# Step 4: Create S3 event notification configuration
echo "Creating S3 event notification template..."

# Create temporary JSON file for S3 notification configuration
cat > /tmp/s3-notification.json <<EOL
{
  "LambdaFunctionConfigurations": [
    {
      "Id": "AutoCategorizeTrigger",
      "LambdaFunctionArn": "arn:aws:lambda:$AWS_REGION:$AWS_ACCOUNT_ID:function:categorize-user-data",
      "Events": ["s3:ObjectCreated:*"],
      "Filter": {
        "Key": {
          "FilterRules": [
            {
              "Name": "prefix",
              "Value": "*/stage1/"
            }
          ]
        },
        "Size": {
          "LessThan": 1048576
        }
      }
    }
  ]
}
EOL

echo "Notification configuration created:"
cat /tmp/s3-notification.json

echo ""
echo "To apply the S3 event notification, run:"
echo "aws s3api put-bucket-notification-configuration --bucket $S3_BUCKET_NAME --notification-configuration file:///tmp/s3-notification.json"
echo ""
echo "Would you like to apply it now? (y/n)"
read -p "> " apply_notification

if [[ "$apply_notification" == "y" ]]; then
  echo "Applying S3 event notification..."
  aws s3api put-bucket-notification-configuration \
    --bucket $S3_BUCKET_NAME \
    --notification-configuration file:///tmp/s3-notification.json \
    --region $AWS_REGION
  
  echo "S3 event notification applied successfully!"
else
  echo "Skipping S3 event notification setup. You can apply it manually later."
fi

echo ""
echo "Deployment completed!"
echo "The Lambda function can now be triggered by:"
echo "1. Manual requests via the API Gateway endpoint"
echo "2. Automatic S3 uploads to */stage1/ paths (if notification was applied)"
echo ""
echo "Test the API endpoint with:"
echo "curl -X POST -H \"Content-Type: application/json\" -H \"Authorization: Bearer <token>\" -d '{\"filePath\":\"path/to/file\", \"fileName\":\"testfile.json\"}' <api-endpoint-url>/categorize"