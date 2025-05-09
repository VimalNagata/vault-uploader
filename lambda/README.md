# Dee-en-eh Data Vault Lambda Functions

This directory contains AWS Lambda functions that support the Dee-en-eh Data Vault application.

## Functions

1. **get-aws-credentials.js**: Generates temporary AWS credentials for authenticated users
2. **google-jwt-authorizer.js**: Validates Google JWT tokens for API Gateway authorization

## Deployment Instructions

### Prerequisites

- AWS CLI installed and configured
- Node.js and npm installed
- An S3 bucket for storing user data
- Google OAuth Client ID (same as used in the frontend)

### Deployment Steps

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Create deployment packages**

   **Option 1: Using npm scripts**
   ```bash
   # Use the npm scripts to create Lambda packages
   npm run build
   ```

   **Option 2: Using the optimized bash script (recommended)**
   ```bash
   # This script creates smaller, more targeted packages
   ./build-lambdas.sh
   ```

   Both options will create:
   - `dist/get-aws-credentials.zip` - Lambda function with AWS SDK
   - `dist/google-jwt-authorizer.zip` - Lambda function with Google Auth Library

   If you encounter issues with package size, use the S3 deployment method in step 4.

3. **Create IAM Role for Lambda Functions**

   Create an IAM role with the following permissions:
   - AWSLambdaBasicExecutionRole (for CloudWatch Logs)
   - For the credentials function, add the following inline policy:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "sts:GetFederationToken"
         ],
         "Resource": "*"
       }
     ]
   }
   ```

4. **Deploy Lambda Functions**

   **Option 1: Direct Upload (for smaller packages)**
   ```bash
   # Deploy authorizer
   aws lambda create-function \
     --function-name google-jwt-authorizer \
     --zip-file fileb://dist/google-jwt-authorizer.zip \
     --handler google-jwt-authorizer.handler \
     --runtime nodejs18.x \
     --role arn:aws:iam::[ACCOUNT-ID]:role/[ROLE-NAME] \
     --environment Variables="{GOOGLE_CLIENT_ID=[YOUR-GOOGLE-CLIENT-ID]}"

   # Deploy credentials function
   aws lambda create-function \
     --function-name get-aws-credentials \
     --zip-file fileb://dist/get-aws-credentials.zip \
     --handler get-aws-credentials.handler \
     --runtime nodejs18.x \
     --role arn:aws:iam::[ACCOUNT-ID]:role/[ROLE-NAME] \
     --environment Variables="{S3_BUCKET_NAME=[YOUR-S3-BUCKET-NAME],AWS_REGION=[YOUR-AWS-REGION]}"
   ```

   **Option 2: S3 Deployment (for packages over 50MB)**
   ```bash
   # Create an S3 bucket for Lambda deployments (if you don't already have one)
   aws s3 mb s3://dee-en-eh-lambda-deploy
   
   # Upload packages to S3
   aws s3 cp dist/get-aws-credentials.zip s3://dee-en-eh-lambda-deploy/
   aws s3 cp dist/google-jwt-authorizer.zip s3://dee-en-eh-lambda-deploy/
   
   # Deploy from S3
   aws lambda create-function \
     --function-name get-aws-credentials \
     --code S3Bucket=dee-en-eh-lambda-deploy,S3Key=get-aws-credentials.zip \
     --handler get-aws-credentials.handler \
     --runtime nodejs18.x \
     --role arn:aws:iam::[ACCOUNT-ID]:role/[ROLE-NAME] \
     --environment Variables="{S3_BUCKET_NAME=[YOUR-S3-BUCKET-NAME],AWS_REGION=[YOUR-AWS-REGION]}"
     
   aws lambda create-function \
     --function-name google-jwt-authorizer \
     --code S3Bucket=dee-en-eh-lambda-deploy,S3Key=google-jwt-authorizer.zip \
     --handler google-jwt-authorizer.handler \
     --runtime nodejs18.x \
     --role arn:aws:iam::[ACCOUNT-ID]:role/[ROLE-NAME] \
     --environment Variables="{GOOGLE_CLIENT_ID=[YOUR-GOOGLE-CLIENT-ID]}"
   ```

5. **Create API Gateway REST API**

   - Create a new REST API in API Gateway
   - Create a `/credentials` resource with a GET method
   - Set the integration type to "Lambda Function"
   - Select the `get-aws-credentials` function
   - Set Method Request to require authorization
   - Configure the authorizer to use the `google-jwt-authorizer` Lambda function

6. **Configure CORS on API Gateway**

   - Enable CORS for the API Gateway resource:
     - Allow headers: 'Content-Type,Authorization'
     - Allow methods: 'GET,OPTIONS'
     - Allow origin: Your frontend domain (or '*' for development)

7. **Deploy the API**

   - Create a new deployment stage (e.g., 'prod')
   - Note the invoke URL, which will be needed in the frontend

8. **Update Frontend Configuration**

   Update the frontend code to use the API Gateway endpoint to get credentials.

## Testing

Test the API Gateway endpoint using a valid Google JWT token:

```bash
curl -H "Authorization: Bearer [GOOGLE-ID-TOKEN]" https://[API-ID].execute-api.[REGION].amazonaws.com/[STAGE]/credentials
```

## Security Considerations

- The Lambda functions include CORS headers set to '*' which should be updated for production
- Consider implementing rate limiting on the API Gateway
- Review and adjust the IAM permissions as needed for your use case
- The temporary credentials are scoped to the user's folder in S3