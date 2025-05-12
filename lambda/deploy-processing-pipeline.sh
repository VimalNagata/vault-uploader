#!/bin/bash
# Script to deploy the full data processing pipeline for Digital DNA

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
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query 'Account' --output text)

echo "Deploying Digital DNA data processing pipeline..."
echo "Using S3 bucket: $S3_BUCKET_NAME"
echo "Using AWS region: $AWS_REGION"
echo "Using AWS account: $AWS_ACCOUNT_ID"

# Step 1: Build Lambda packages
echo "Building Lambda packages..."
./build-lambdas.sh

# Function to deploy or update a Lambda function
deploy_lambda_function() {
  local function_name=$1
  local role_name=$2
  local env_vars=$3
  
  echo ""
  echo "Deploying Lambda function: $function_name"
  
  # Check if function already exists
  if aws lambda get-function --function-name $function_name --region $AWS_REGION >/dev/null 2>&1; then
    echo "Function exists, updating..."
    
    # Update function code
    aws lambda update-function-code \
      --function-name $function_name \
      --zip-file fileb://dist/$function_name.zip \
      --region $AWS_REGION
    
    # Update function configuration if environment variables are provided
    if [ -n "$env_vars" ]; then
      echo "Updating environment variables..."
      aws lambda update-function-configuration \
        --function-name $function_name \
        --environment "$env_vars" \
        --region $AWS_REGION
    fi
    
    echo "Function updated successfully."
  else
    echo "Function does not exist, creating..."
    
    # Get or create IAM role
    local role_arn
    if aws iam get-role --role-name $role_name >/dev/null 2>&1; then
      role_arn=$(aws iam get-role --role-name $role_name --query 'Role.Arn' --output text)
      echo "Using existing role: $role_name ($role_arn)"
    else
      echo "Role $role_name doesn't exist. Please enter the full ARN for the Lambda role:"
      read -p "> " role_arn
    fi
    
    # Create function
    aws lambda create-function \
      --function-name $function_name \
      --runtime nodejs18.x \
      --handler "$function_name.handler" \
      --role "$role_arn" \
      --zip-file fileb://dist/$function_name.zip \
      --timeout 60 \
      --memory-size 256 \
      --environment "$env_vars" \
      --region $AWS_REGION
    
    echo "Function created successfully."
  fi
}

# Step 2: Deploy all Lambda functions

# Environment variables for categorize-user-data Lambda
CATEGORIZE_ENV='{"Variables":{"S3_BUCKET_NAME":"'$S3_BUCKET_NAME'","OPENAI_API_KEY":"'$OPENAI_API_KEY'"}}'
deploy_lambda_function "categorize-user-data" "lambda-categorize-user-data-role" "$CATEGORIZE_ENV"

# Environment variables for persona-builder Lambda
PERSONA_ENV='{"Variables":{"S3_BUCKET_NAME":"'$S3_BUCKET_NAME'","OPENAI_API_KEY":"'$OPENAI_API_KEY'"}}'
deploy_lambda_function "persona-builder" "lambda-persona-builder-role" "$PERSONA_ENV"

# Environment variables for orchestrator Lambda
ORCHESTRATOR_ENV='{"Variables":{"S3_BUCKET_NAME":"'$S3_BUCKET_NAME'"}}'
deploy_lambda_function "data-processing-orchestrator" "lambda-data-processing-orchestrator-role" "$ORCHESTRATOR_ENV"

# Step 3: Configure API Gateway (for direct invocation)
echo ""
echo "Configuring API Gateway..."
./configure-categorize-api.sh --deploy

# Step 4: Set up permissions for Lambda functions

# Permission for S3 to invoke the orchestrator
echo ""
echo "Adding permission for S3 to invoke orchestrator Lambda..."
aws lambda add-permission \
  --function-name data-processing-orchestrator \
  --principal s3.amazonaws.com \
  --statement-id S3InvokePermission \
  --action "lambda:InvokeFunction" \
  --source-arn "arn:aws:s3:::$S3_BUCKET_NAME" \
  --region $AWS_REGION || echo "Permission may already exist"

# Permission for orchestrator to invoke other Lambdas
echo ""
echo "Adding permission for orchestrator to invoke other Lambdas..."

aws lambda add-permission \
  --function-name categorize-user-data \
  --principal lambda.amazonaws.com \
  --statement-id OrchestratorInvokePermission \
  --action "lambda:InvokeFunction" \
  --source-arn "arn:aws:lambda:$AWS_REGION:$AWS_ACCOUNT_ID:function:data-processing-orchestrator" \
  --region $AWS_REGION || echo "Permission may already exist"

aws lambda add-permission \
  --function-name persona-builder \
  --principal lambda.amazonaws.com \
  --statement-id OrchestratorInvokePermission \
  --action "lambda:InvokeFunction" \
  --source-arn "arn:aws:lambda:$AWS_REGION:$AWS_ACCOUNT_ID:function:data-processing-orchestrator" \
  --region $AWS_REGION || echo "Permission may already exist"

# Step 5: Configure S3 event notification
echo ""
echo "Creating S3 event notification configuration..."

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

echo "Created notification configuration:"
cat /tmp/orchestrator-notification.json

echo ""
echo "To apply the S3 event notification, run:"
echo "aws s3api put-bucket-notification-configuration --bucket $S3_BUCKET_NAME --notification-configuration file:///tmp/orchestrator-notification.json"
echo ""
echo "Would you like to apply it now? (y/n)"
read -p "> " apply_notification

if [[ "$apply_notification" == "y" ]]; then
  echo "Applying S3 event notification..."
  aws s3api put-bucket-notification-configuration \
    --bucket $S3_BUCKET_NAME \
    --notification-configuration file:///tmp/orchestrator-notification.json \
    --region $AWS_REGION
  
  echo "S3 event notification applied successfully!"
else
  echo "Skipping S3 event notification setup. You can apply it manually later."
fi

echo ""
echo "Deployment completed!"
echo ""
echo "Digital DNA Data Processing Pipeline is now set up:"
echo "1. data-processing-orchestrator - Triggered on all S3 uploads to */stage* paths"
echo "2. categorize-user-data - Processes files in stage1"
echo "3. persona-builder - Processes categorized files in stage2 and updates personas in stage3"
echo ""
echo "You can also trigger processing manually via API Gateway endpoints."
echo ""
echo "To see logs for the Lambda functions, use the AWS CloudWatch console or AWS CLI:"
echo "aws logs tail /aws/lambda/data-processing-orchestrator --follow"