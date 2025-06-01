#!/bin/bash
# Script to configure API Gateway for the prompt-manager Lambda function

# Set variables
API_NAME="ccpa-uploader-api"
STAGE_NAME="prod"
REGION=${AWS_REGION:-"us-east-1"}
LAMBDA_NAME="prompt-manager"

echo "Configuring API Gateway for $LAMBDA_NAME..."

# Get Lambda function ARN
LAMBDA_ARN=$(aws lambda get-function --function-name $LAMBDA_NAME --query "Configuration.FunctionArn" --output text --region $REGION)
if [ -z "$LAMBDA_ARN" ]; then
  echo "Error: Lambda function $LAMBDA_NAME not found"
  exit 1
fi

echo "Using Lambda ARN: $LAMBDA_ARN"

# Find existing API ID
API_ID=$(aws apigateway get-rest-apis --query "items[?name=='$API_NAME'].id" --output text --region $REGION)
if [ -z "$API_ID" ]; then
  echo "API $API_NAME not found. Creating new API..."
  API_ID=$(aws apigateway create-rest-api --name $API_NAME --region $REGION --query 'id' --output text)
  echo "Created new API with ID: $API_ID"
else
  echo "Found existing API with ID: $API_ID"
fi

# Get the root resource ID
ROOT_ID=$(aws apigateway get-resources --rest-api-id $API_ID --region $REGION --query 'items[?path==`/`].id' --output text)
echo "Root resource ID: $ROOT_ID"

# Check if the resource already exists
RESOURCE_ID=$(aws apigateway get-resources --rest-api-id $API_ID --region $REGION --query "items[?path=='/prompt-manager'].id" --output text)

if [ -z "$RESOURCE_ID" ]; then
  echo "Creating new resource /prompt-manager..."
  RESOURCE_ID=$(aws apigateway create-resource --rest-api-id $API_ID --parent-id $ROOT_ID --path-part "prompt-manager" --region $REGION --query 'id' --output text)
  echo "Created resource with ID: $RESOURCE_ID"
else
  echo "Resource /prompt-manager already exists with ID: $RESOURCE_ID"
fi

# Create or update methods
# Check if OPTIONS method exists
OPTIONS_EXISTS=$(aws apigateway get-method --rest-api-id $API_ID --resource-id $RESOURCE_ID --http-method OPTIONS --region $REGION 2>/dev/null)

if [ -z "$OPTIONS_EXISTS" ]; then
  echo "Creating OPTIONS method..."
  aws apigateway put-method \
    --rest-api-id $API_ID \
    --resource-id $RESOURCE_ID \
    --http-method OPTIONS \
    --authorization-type NONE \
    --region $REGION

  # Create OPTIONS method response
  aws apigateway put-method-response \
    --rest-api-id $API_ID \
    --resource-id $RESOURCE_ID \
    --http-method OPTIONS \
    --status-code 200 \
    --response-parameters "{\"method.response.header.Access-Control-Allow-Headers\":true,\"method.response.header.Access-Control-Allow-Methods\":true,\"method.response.header.Access-Control-Allow-Origin\":true}" \
    --region $REGION

  # Create OPTIONS integration
  aws apigateway put-integration \
    --rest-api-id $API_ID \
    --resource-id $RESOURCE_ID \
    --http-method OPTIONS \
    --type MOCK \
    --request-templates '{"application/json":"{\"statusCode\": 200}"}' \
    --region $REGION

  # Create OPTIONS integration response
  aws apigateway put-integration-response \
    --rest-api-id $API_ID \
    --resource-id $RESOURCE_ID \
    --http-method OPTIONS \
    --status-code 200 \
    --response-parameters "{\"method.response.header.Access-Control-Allow-Headers\":\"'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token'\",\"method.response.header.Access-Control-Allow-Methods\":\"'GET,POST,PUT,OPTIONS'\",\"method.response.header.Access-Control-Allow-Origin\":\"'*'\"}" \
    --response-templates '{"application/json":""}' \
    --region $REGION
    
  echo "Created OPTIONS method"
fi

# Set up GET method
GET_EXISTS=$(aws apigateway get-method --rest-api-id $API_ID --resource-id $RESOURCE_ID --http-method GET --region $REGION 2>/dev/null)

if [ -z "$GET_EXISTS" ]; then
  echo "Creating GET method..."
  # Create GET method
  aws apigateway put-method \
    --rest-api-id $API_ID \
    --resource-id $RESOURCE_ID \
    --http-method GET \
    --authorization-type CUSTOM \
    --authorizer-id $(aws apigateway get-authorizers --rest-api-id $API_ID --region $REGION --query 'items[0].id' --output text) \
    --region $REGION

  # Create GET integration
  aws apigateway put-integration \
    --rest-api-id $API_ID \
    --resource-id $RESOURCE_ID \
    --http-method GET \
    --type AWS_PROXY \
    --integration-http-method POST \
    --uri "arn:aws:apigateway:$REGION:lambda:path/2015-03-31/functions/$LAMBDA_ARN/invocations" \
    --region $REGION

  # Create GET method response
  aws apigateway put-method-response \
    --rest-api-id $API_ID \
    --resource-id $RESOURCE_ID \
    --http-method GET \
    --status-code 200 \
    --response-parameters "{\"method.response.header.Access-Control-Allow-Origin\":true}" \
    --region $REGION
    
  echo "Created GET method"
fi

# Set up POST method
POST_EXISTS=$(aws apigateway get-method --rest-api-id $API_ID --resource-id $RESOURCE_ID --http-method POST --region $REGION 2>/dev/null)

if [ -z "$POST_EXISTS" ]; then
  echo "Creating POST method..."
  # Create POST method
  aws apigateway put-method \
    --rest-api-id $API_ID \
    --resource-id $RESOURCE_ID \
    --http-method POST \
    --authorization-type CUSTOM \
    --authorizer-id $(aws apigateway get-authorizers --rest-api-id $API_ID --region $REGION --query 'items[0].id' --output text) \
    --region $REGION

  # Create POST integration
  aws apigateway put-integration \
    --rest-api-id $API_ID \
    --resource-id $RESOURCE_ID \
    --http-method POST \
    --type AWS_PROXY \
    --integration-http-method POST \
    --uri "arn:aws:apigateway:$REGION:lambda:path/2015-03-31/functions/$LAMBDA_ARN/invocations" \
    --region $REGION

  # Create POST method response
  aws apigateway put-method-response \
    --rest-api-id $API_ID \
    --resource-id $RESOURCE_ID \
    --http-method POST \
    --status-code 200 \
    --response-parameters "{\"method.response.header.Access-Control-Allow-Origin\":true}" \
    --region $REGION
    
  echo "Created POST method"
fi

# Set up PUT method
PUT_EXISTS=$(aws apigateway get-method --rest-api-id $API_ID --resource-id $RESOURCE_ID --http-method PUT --region $REGION 2>/dev/null)

if [ -z "$PUT_EXISTS" ]; then
  echo "Creating PUT method..."
  # Create PUT method
  aws apigateway put-method \
    --rest-api-id $API_ID \
    --resource-id $RESOURCE_ID \
    --http-method PUT \
    --authorization-type CUSTOM \
    --authorizer-id $(aws apigateway get-authorizers --rest-api-id $API_ID --region $REGION --query 'items[0].id' --output text) \
    --region $REGION

  # Create PUT integration
  aws apigateway put-integration \
    --rest-api-id $API_ID \
    --resource-id $RESOURCE_ID \
    --http-method PUT \
    --type AWS_PROXY \
    --integration-http-method POST \
    --uri "arn:aws:apigateway:$REGION:lambda:path/2015-03-31/functions/$LAMBDA_ARN/invocations" \
    --region $REGION

  # Create PUT method response
  aws apigateway put-method-response \
    --rest-api-id $API_ID \
    --resource-id $RESOURCE_ID \
    --http-method PUT \
    --status-code 200 \
    --response-parameters "{\"method.response.header.Access-Control-Allow-Origin\":true}" \
    --region $REGION
    
  echo "Created PUT method"
fi

# Check if deployment is requested
if [ "$1" == "--deploy" ] || [ "$2" == "--deploy" ]; then
  # Deploy the API
  STAGE=$([ "$2" == "--stage" ] && echo "$3" || echo "$STAGE_NAME")
  echo "Deploying API to stage: $STAGE"
  
  DEPLOYMENT_ID=$(aws apigateway create-deployment \
    --rest-api-id $API_ID \
    --stage-name $STAGE \
    --region $REGION \
    --query 'id' \
    --output text)
  
  echo "API deployed with deployment ID: $DEPLOYMENT_ID"
  echo "API Gateway endpoint: https://$API_ID.execute-api.$REGION.amazonaws.com/$STAGE/prompt-manager"
  
  # Add Lambda permissions if needed
  STATEMENT_ID="apigateway-prompt-manager-$STAGE"
  if ! aws lambda get-policy --function-name $LAMBDA_NAME --region $REGION 2>/dev/null | grep -q "$STATEMENT_ID"; then
    echo "Adding Lambda permission for API Gateway..."
    aws lambda add-permission \
      --function-name $LAMBDA_NAME \
      --statement-id "$STATEMENT_ID" \
      --action "lambda:InvokeFunction" \
      --principal apigateway.amazonaws.com \
      --source-arn "arn:aws:execute-api:$REGION:$(aws sts get-caller-identity --query 'Account' --output text):$API_ID/*/*/*" \
      --region $REGION
    
    echo "Lambda permission added"
  else
    echo "Lambda permission already exists"
  fi
fi

echo "API Gateway configuration completed for $LAMBDA_NAME"