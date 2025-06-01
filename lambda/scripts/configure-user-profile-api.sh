#!/bin/bash

# Configure API Gateway for user-profile-builder Lambda function

set -e

echo "Configuring API Gateway for user-profile-builder Lambda..."

# Define variables
API_NAME="dee-en-eh-api"
LAMBDA_NAME="user-profile-builder"
REGION="us-east-1"  # Change to your region if different
STAGE_NAME="prod"

# Get the Lambda ARN
LAMBDA_ARN=$(aws lambda get-function --function-name $LAMBDA_NAME --region $REGION --query 'Configuration.FunctionArn' --output text)

echo "Lambda ARN: $LAMBDA_ARN"

# Check if API already exists
API_ID=$(aws apigateway get-rest-apis --region $REGION --query "items[?name=='$API_NAME'].id" --output text)

if [ -z "$API_ID" ]; then
  echo "Creating new API Gateway: $API_NAME"
  API_ID=$(aws apigateway create-rest-api --name "$API_NAME" --region $REGION --query 'id' --output text)
else
  echo "Using existing API Gateway: $API_NAME (ID: $API_ID)"
fi

# Get the root resource ID
ROOT_RESOURCE_ID=$(aws apigateway get-resources --rest-api-id $API_ID --region $REGION --query 'items[?path=='/'].id' --output text)

# Create user-profile resource
echo "Creating user-profile resource..."
RESOURCE_ID=$(aws apigateway create-resource --rest-api-id $API_ID --parent-id $ROOT_RESOURCE_ID --path-part "user-profile" --region $REGION --query 'id' --output text)

# Create POST method
echo "Creating POST method..."
aws apigateway put-method --rest-api-id $API_ID --resource-id $RESOURCE_ID --http-method POST --authorization-type "COGNITO_USER_POOLS" --authorizer-id "YOUR_COGNITO_AUTHORIZER_ID" --region $REGION

# Create integration with Lambda
echo "Creating Lambda integration..."
aws apigateway put-integration --rest-api-id $API_ID --resource-id $RESOURCE_ID --http-method POST --type AWS_PROXY --integration-http-method POST --uri "arn:aws:apigateway:$REGION:lambda:path/2015-03-31/functions/$LAMBDA_ARN/invocations" --region $REGION

# Create method response
echo "Creating method response..."
aws apigateway put-method-response --rest-api-id $API_ID --resource-id $RESOURCE_ID --http-method POST --status-code 200 --response-models '{"application/json": "Empty"}' --region $REGION

# Enable CORS
echo "Enabling CORS..."
aws apigateway put-method --rest-api-id $API_ID --resource-id $RESOURCE_ID --http-method OPTIONS --authorization-type NONE --region $REGION

aws apigateway put-integration --rest-api-id $API_ID --resource-id $RESOURCE_ID --http-method OPTIONS --type MOCK --integration-http-method OPTIONS --request-templates '{"application/json": "{\"statusCode\": 200}"}' --region $REGION

aws apigateway put-method-response --rest-api-id $API_ID --resource-id $RESOURCE_ID --http-method OPTIONS --status-code 200 --response-parameters '{"method.response.header.Access-Control-Allow-Headers": true, "method.response.header.Access-Control-Allow-Methods": true, "method.response.header.Access-Control-Allow-Origin": true}' --response-models '{"application/json": "Empty"}' --region $REGION

aws apigateway put-integration-response --rest-api-id $API_ID --resource-id $RESOURCE_ID --http-method OPTIONS --status-code 200 --response-parameters '{"method.response.header.Access-Control-Allow-Headers": "'"'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token'"'", "method.response.header.Access-Control-Allow-Methods": "'"'OPTIONS,POST'"'", "method.response.header.Access-Control-Allow-Origin": "'"'*'"'"}' --response-templates '{"application/json": ""}' --region $REGION

# Deploy the API
echo "Deploying API to stage: $STAGE_NAME"
DEPLOYMENT_ID=$(aws apigateway create-deployment --rest-api-id $API_ID --stage-name $STAGE_NAME --region $REGION --query 'id' --output text)

# Add Lambda permission
echo "Adding Lambda permission for API Gateway..."
aws lambda add-permission --function-name $LAMBDA_NAME --statement-id apigateway-test-$(date +%s) --action lambda:InvokeFunction --principal apigateway.amazonaws.com --source-arn "arn:aws:execute-api:$REGION:$(aws sts get-caller-identity --query Account --output text):$API_ID/*/*/*" --region $REGION

# Get the API endpoint
API_ENDPOINT="https://$API_ID.execute-api.$REGION.amazonaws.com/$STAGE_NAME/user-profile"
echo "API Gateway endpoint: $API_ENDPOINT"
echo ""
echo "IMPORTANT: Update your application's environment variables with this endpoint."
echo "Add the following to your .env file:"
echo "USER_PROFILE_API_ENDPOINT=$API_ENDPOINT"
echo ""
echo "Configuration complete!"