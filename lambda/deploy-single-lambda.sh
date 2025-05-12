#!/bin/bash
# Script to deploy a single Lambda function with minimal output

set -e  # Exit immediately if a command exits with a non-zero status

# Check for Lambda name
if [ -z "$1" ]; then
  echo "Error: Lambda function name is required."
  echo "Usage: ./deploy-single-lambda.sh <lambda-name> [--create]"
  echo "Example: ./deploy-single-lambda.sh data-processing-orchestrator --create"
  exit 1
fi

LAMBDA_NAME=$1
CREATE_NEW=false

# Parse flags
if [ "$2" == "--create" ]; then
  CREATE_NEW=true
fi

# Set AWS region (can be overridden with environment variable)
AWS_REGION=${AWS_REGION:-"us-east-1"}
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query 'Account' --output text)

echo "Deploying Lambda function: $LAMBDA_NAME"
echo "Using AWS region: $AWS_REGION"
echo "Using AWS account: $AWS_ACCOUNT_ID"

# Step 1: Build Lambda package
echo "Building Lambda package..."

# Create temporary directory
TEMP_DIR="temp_$LAMBDA_NAME"
mkdir -p $TEMP_DIR
mkdir -p dist

# Copy Lambda file
cp $LAMBDA_NAME.js $TEMP_DIR/
echo "Lambda file copied to temp directory"

# Create package.json
cat > $TEMP_DIR/package.json <<EOL
{
  "name": "$LAMBDA_NAME",
  "version": "1.0.0",
  "main": "$LAMBDA_NAME.js",
  "dependencies": {
    "aws-sdk": "^2.1469.0"
  }
}
EOL

# Install dependencies with minimal output
echo "Installing dependencies (this may take a minute)..."
(cd $TEMP_DIR && npm install --production --silent)
echo "Dependencies installed"

# Create zip file with minimal output
echo "Creating zip file..."
(cd $TEMP_DIR && zip -r "../dist/$LAMBDA_NAME.zip" . -q)
echo "Zip file created at dist/$LAMBDA_NAME.zip"

# Clean up temporary directory
rm -rf $TEMP_DIR
echo "Temporary directory cleaned up"

# Step 2: Deploy Lambda function
echo "Deploying Lambda function: $LAMBDA_NAME"

# Check if Lambda already exists
if aws lambda get-function --function-name $LAMBDA_NAME --region $AWS_REGION > /dev/null 2>&1; then
  if [ "$CREATE_NEW" = true ]; then
    echo "Error: Lambda function $LAMBDA_NAME already exists. Use without --create to update it."
    exit 1
  fi
  
  # Update existing function
  echo "Updating existing Lambda function..."
  
  # Update function code
  aws lambda update-function-code \
    --function-name $LAMBDA_NAME \
    --zip-file fileb://dist/$LAMBDA_NAME.zip \
    --region $AWS_REGION \
    --publish > /dev/null
  
  # Set environment variables based on Lambda function
  if [ "$LAMBDA_NAME" == "data-processing-orchestrator" ]; then
    # Orchestrator only needs S3 bucket name
    aws lambda update-function-configuration \
      --function-name $LAMBDA_NAME \
      --environment "Variables={S3_BUCKET_NAME=${S3_BUCKET_NAME:-dee-en-eh-bucket}}" \
      --region $AWS_REGION > /dev/null
  
  elif [ "$LAMBDA_NAME" == "persona-builder" ] || [ "$LAMBDA_NAME" == "categorize-user-data" ]; then
    # Check for OpenAI API key
    if [ -z "$OPENAI_API_KEY" ]; then
      echo "Warning: OPENAI_API_KEY environment variable is not set."
      echo "Using existing OpenAI API key for the Lambda if it has one."
      
      # Get current environment variables
      ENV_VARS=$(aws lambda get-function-configuration \
        --function-name $LAMBDA_NAME \
        --region $AWS_REGION \
        --query 'Environment.Variables' \
        --output json)
      
      # Check if environment variables exist
      if [ "$ENV_VARS" == "null" ]; then
        echo "Error: No existing OpenAI API key found for the Lambda."
        echo "Please set OPENAI_API_KEY environment variable."
        exit 1
      fi
    else
      # Update with both S3 bucket and OpenAI API key
      aws lambda update-function-configuration \
        --function-name $LAMBDA_NAME \
        --environment "Variables={S3_BUCKET_NAME=${S3_BUCKET_NAME:-dee-en-eh-bucket},OPENAI_API_KEY=$OPENAI_API_KEY}" \
        --region $AWS_REGION > /dev/null
    fi
  fi
  
  echo "Lambda function updated successfully."
else
  if [ "$CREATE_NEW" = false ]; then
    echo "Lambda function $LAMBDA_NAME does not exist. Use --create flag to create it."
    exit 1
  fi
  
  # Create new function
  echo "Creating new Lambda function..."
  
  # Ask for IAM role ARN
  echo "Please enter IAM role ARN for $LAMBDA_NAME:"
  read ROLE_ARN
  
  # Set environment variables based on Lambda function
  if [ "$LAMBDA_NAME" == "data-processing-orchestrator" ]; then
    # Orchestrator only needs S3 bucket name
    ENV_VARS="Variables={S3_BUCKET_NAME=${S3_BUCKET_NAME:-dee-en-eh-bucket}}"
  
  elif [ "$LAMBDA_NAME" == "persona-builder" ] || [ "$LAMBDA_NAME" == "categorize-user-data" ]; then
    # Check for OpenAI API key
    if [ -z "$OPENAI_API_KEY" ]; then
      echo "Error: OPENAI_API_KEY environment variable is required."
      echo "Please set it with: export OPENAI_API_KEY=your-openai-api-key"
      exit 1
    fi
    
    # Both S3 bucket and OpenAI API key
    ENV_VARS="Variables={S3_BUCKET_NAME=${S3_BUCKET_NAME:-dee-en-eh-bucket},OPENAI_API_KEY=$OPENAI_API_KEY}"
  fi
  
  # Create function
  aws lambda create-function \
    --function-name $LAMBDA_NAME \
    --runtime nodejs18.x \
    --handler "$LAMBDA_NAME.handler" \
    --role "$ROLE_ARN" \
    --zip-file fileb://dist/$LAMBDA_NAME.zip \
    --timeout 60 \
    --memory-size 256 \
    --environment "$ENV_VARS" \
    --region $AWS_REGION > /dev/null
  
  echo "Lambda function created successfully."
fi

# Step 3: Add appropriate permissions
echo "Setting up Lambda permissions..."

# Check if this is the orchestrator
if [ "$LAMBDA_NAME" == "data-processing-orchestrator" ]; then
  # Add permission for S3 to invoke orchestrator
  aws lambda add-permission \
    --function-name $LAMBDA_NAME \
    --principal s3.amazonaws.com \
    --statement-id S3InvokePermission \
    --action "lambda:InvokeFunction" \
    --source-arn "arn:aws:s3:::${S3_BUCKET_NAME:-dee-en-eh-bucket}" \
    --region $AWS_REGION > /dev/null 2>&1 || echo "S3 permission already exists or failed to add"
  
  echo "Added permission for S3 to invoke orchestrator"
else
  # Add permission for orchestrator to invoke this Lambda
  aws lambda add-permission \
    --function-name $LAMBDA_NAME \
    --principal lambda.amazonaws.com \
    --statement-id OrchestratorInvokePermission \
    --action "lambda:InvokeFunction" \
    --source-arn "arn:aws:lambda:$AWS_REGION:$AWS_ACCOUNT_ID:function:data-processing-orchestrator" \
    --region $AWS_REGION > /dev/null 2>&1 || echo "Orchestrator permission already exists or failed to add"
  
  echo "Added permission for orchestrator to invoke $LAMBDA_NAME"
fi

echo ""
echo "Deployment of $LAMBDA_NAME completed successfully!"
echo ""

# Step 4: Configure S3 event notification for orchestrator
if [ "$LAMBDA_NAME" == "data-processing-orchestrator" ] && [ "$CREATE_NEW" = true ]; then
  echo "Do you want to configure S3 event notification for the orchestrator? (y/n)"
  read CONFIGURE_S3_EVENT
  
  if [ "$CONFIGURE_S3_EVENT" == "y" ]; then
    echo "Creating S3 event notification..."
    
    # Create notification configuration
    cat > /tmp/orchestrator-notification.json <<EOL
{
  "LambdaFunctionConfigurations": [
    {
      "Id": "ProcessingPipelineTrigger",
      "LambdaFunctionArn": "arn:aws:lambda:$AWS_REGION:$AWS_ACCOUNT_ID:function:data-processing-orchestrator",
      "Events": ["s3:ObjectCreated:*"],
      "Filter": {
        "Key": {
          "FilterRules": [
            {
              "Name": "prefix",
              "Value": "*/stage"
            }
          ]
        }
      }
    }
  ]
}
EOL
    
    # Apply S3 notification
    aws s3api put-bucket-notification-configuration \
      --bucket ${S3_BUCKET_NAME:-dee-en-eh-bucket} \
      --notification-configuration file:///tmp/orchestrator-notification.json \
      --region $AWS_REGION
    
    echo "S3 event notification configured successfully!"
  fi
fi