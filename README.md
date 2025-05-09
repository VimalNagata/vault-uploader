# Dee-en-eh Data Vault Uploader

A secure application for uploading and managing personal data with Google authentication and AWS S3 storage.

## Production Deployment Information

### Domain Configuration
- Custom Domain: [https://digitaldna.red/](https://digitaldna.red/)
- Domain Registration: AWS Route 53
- DNS Management: AWS Route 53

### CloudFront Distribution
- Distribution ID: `E3QB86OHQX5C36`
- Origin: `http://dee-en-eh-react-app.s3-website-us-east-1.amazonaws.com/`
- SSL Certificate ARN: `arn:aws:acm:us-east-1:390844768511:certificate/9d066d29-7d82-47fa-87b8-3b16bc1fb4ba`

### S3 Hosting
- Bucket: `dee-en-eh-react-app`
- Website Endpoint: [http://dee-en-eh-react-app.s3-website-us-east-1.amazonaws.com/](http://dee-en-eh-react-app.s3-website-us-east-1.amazonaws.com/)

### Google OAuth Configuration
- Project: `dee-en-eh-client` (https://console.cloud.google.com/apis/credentials)
- Authorized JavaScript Origins:
  - `https://digitaldna.red`
  - `http://dee-en-eh-react-app.s3-website-us-east-1.amazonaws.com`

## Features

- Secure authentication with Google OAuth
- Temporary AWS credentials generated per user
- Fine-grained access control for S3 objects
- User-specific folders for data separation
- Lightweight React frontend
- Serverless backend using AWS Lambda and API Gateway

## Architecture

This application uses the following components:

1. **Frontend**: React application with TypeScript
2. **Authentication**: Google OAuth for user identity
3. **Backend**: AWS Lambda functions and API Gateway
4. **Storage**: Amazon S3 for secure data storage
5. **Authorization**: Custom Lambda authorizer for token validation

## Setup Instructions

### Prerequisites

- Node.js 14+ and npm
- AWS account with appropriate permissions
- Google Cloud Console project with OAuth credentials
- AWS CLI configured with admin permissions

### Environment Configuration

1. Create a `.env` file by copying `.env.example` and filling in the values:

```bash
cp .env.example .env
```

2. Configure the following environment variables:

```
# Google Authentication
REACT_APP_GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com

# AWS Configuration
REACT_APP_AWS_REGION=us-east-1
REACT_APP_S3_BUCKET_NAME=your-s3-bucket-name

# API Gateway URL for the get-aws-credentials Lambda function
REACT_APP_CREDENTIALS_API_URL=https://[API_ID].execute-api.[REGION].amazonaws.com/[STAGE]/credentials
```

### Setting up Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project
3. Navigate to APIs & Services → Credentials
4. Create an OAuth 2.0 Client ID
   - For local development: Add `http://localhost:3000` as an authorized JavaScript origin
   - For production: Add your production domain
5. Copy the Client ID to the `.env` file

### AWS Lambda Functions Setup

1. Navigate to the lambda directory and build the deployment packages:

```bash
cd lambda
chmod +x build-lambdas.sh
./build-lambdas.sh
```

2. Create an IAM role for S3 access:

```bash
# Create a Trust Policy file
cat > s3-access-trust-policy.json <<EOL
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    },
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::[ACCOUNT_ID]:role/[LAMBDA_ROLE]"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOL

# Create the role that will be assumed for S3 access
aws iam create-role \
  --role-name s3-user-access-role \
  --assume-role-policy-document file://s3-access-trust-policy.json

# Attach permissions for S3 operations
aws iam attach-role-policy \
  --role-name s3-user-access-role \
  --policy-arn arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess
```

3. Create the Lambda functions in AWS console or using AWS CLI:

```bash
# Create the Google JWT Authorizer Lambda
aws lambda create-function \
  --function-name google-jwt-authorizer \
  --runtime nodejs16.x \
  --handler google-jwt-authorizer.handler \
  --zip-file fileb://dist/google-jwt-authorizer.zip \
  --role arn:aws:iam::[ACCOUNT_ID]:role/[LAMBDA_ROLE] \
  --environment "Variables={GOOGLE_CLIENT_ID=[YOUR_CLIENT_ID]}"

# Create the AWS Credentials Lambda with permission to assume role
aws lambda create-function \
  --function-name get-aws-credentials \
  --runtime nodejs16.x \
  --handler get-aws-credentials.handler \
  --zip-file fileb://dist/get-aws-credentials.zip \
  --role arn:aws:iam::[ACCOUNT_ID]:role/[LAMBDA_ROLE_WITH_STS_PERMISSIONS] \
  --environment "Variables={S3_BUCKET_NAME=[YOUR_BUCKET_NAME],AWS_REGION=[YOUR_REGION],S3_ROLE_ARN=arn:aws:iam::[ACCOUNT_ID]:role/s3-user-access-role}"
```

Ensure the Lambda role has permission to call `sts:AssumeRole` by attaching a policy like:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "sts:AssumeRole",
      "Resource": "arn:aws:iam::[ACCOUNT_ID]:role/s3-user-access-role"
    }
  ]
}
```

The assumed S3 role needs to trust the Lambda execution role. Create a role with this trust policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::[ACCOUNT_ID]:role/[LAMBDA_EXECUTION_ROLE]"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

Do not attach any permission policies to this role; our Lambda dynamically provides an inline policy during the AssumeRole call that scopes access to the user's prefix only.

> **Important Note**: If using Node.js 18 or higher Lambda runtimes, you must explicitly include the aws-sdk package in your deployment, as it's no longer bundled in the runtime. Our build scripts handle this for you.

3. Set up API Gateway:
   - Create a new REST API
   - Create a resource `/credentials`
   - Set up a GET method with Lambda integration to the get-aws-credentials function
   - Configure the authorizer to use the google-jwt-authorizer function
   - Enable CORS on all resources
   - Deploy the API to a stage
   - Copy the API URL to the `.env` file

4. Update Lambda functions after changes:

```bash
# Make scripts executable
chmod +x update-authorizer.sh update-credentials.sh

# Update the authorizer Lambda
./update-authorizer.sh

# Update the credentials Lambda
./update-credentials.sh
```

### Frontend Setup

1. Install dependencies:

```bash
npm install
```

2. Start the development server:

```bash
npm start
```

3. Build for production:

```bash
npm run build
```

## Debugging Common Issues

### CORS Issues

1. Ensure your API Gateway has CORS enabled:
   - OPTIONS method configured for all resources
   - Access-Control-Allow-Origin header set to the frontend origin
   - Access-Control-Allow-Headers includes Authorization and Content-Type
   - Access-Control-Allow-Methods includes GET, OPTIONS

2. Check the Lambda response headers:
   - All Lambda functions should return the correct CORS headers
   - Origin headers in the browser request should match the allowed origins

### Authentication Problems

1. Ensure your Google Client ID is correct in both:
   - Frontend .env file
   - Google JWT Authorizer Lambda environment variables

2. Check browser console for token-related errors

3. Verify the token flow:
   - Login component gets a valid access token
   - Token is properly stored in AuthService
   - Token is included in Authorization header for API calls

### AWS Credentials Issues

1. Ensure the Lambda role has STS:GetFederationToken permissions

2. Check CloudWatch logs for specific error messages

3. Verify the S3 bucket exists and is configured properly

## Troubleshooting Guide

### "Failed to fetch" Error

1. Check browser network tab for detailed error information
2. Verify the API Gateway URL is correct in .env
3. Ensure CORS is properly configured
4. Check that Lambda functions are returning proper headers

### "Not authenticated" Error

1. Verify Google login is working and token is stored
2. Check authorizer Lambda logs for token verification errors
3. Ensure the authorizer is properly configured in API Gateway

### "Error generating credentials" Error

1. Check STS permissions for the Lambda role
2. Verify S3 bucket name and region in Lambda environment
3. Check CloudWatch logs for detailed error information

If you see any of these errors:
- "MissingRequiredParameter: Missing required key 'Name' in params"
- "UnexpectedParameter: Unexpected key 'RoleSessionName'"
- "Value at 'name' failed to satisfy constraint: Member must have length less than or equal to 32"
- "AccessDenied: Cannot call GetFederationToken with session credentials"

```bash
# Update the credentials Lambda with the fixed version
cd lambda
./update-credentials.sh
```

For the "Cannot call GetFederationToken with session credentials" error, you need to:
1. Create an IAM role that your Lambda can assume (see IAM role setup instructions)
2. Update your Lambda environment variables to include S3_ROLE_ARN
3. Give your Lambda's execution role permission to call sts:AssumeRole

### "Cannot find module 'aws-sdk'" Error 

This error occurs when running Lambda functions with Node.js 18+ runtimes, as AWS no longer bundles aws-sdk in the runtime:

1. Rebuild your Lambda packages:
```bash
cd lambda
./build-lambdas.sh
```

2. Update your Lambda functions:
```bash
./update-credentials.sh
```

3. Alternatively, downgrade your Lambda runtime to Node.js 16.x, which still includes aws-sdk.

## Deployment to S3 and CloudFront

### Prerequisites

Ensure you have the following set up before deploying:

1. AWS CLI installed and configured with appropriate permissions
2. S3 bucket for website hosting (dee-en-eh-react-app)
3. CloudFront distribution pointing to the S3 bucket website endpoint
4. Route 53 DNS configuration (if using a custom domain)

### Deployment Script

A deployment script `deploy-react-app.sh` has been created for easy deployment from your local machine.

To deploy the React application:

1. Make sure your AWS credentials are configured:
```bash
aws configure
```

2. Run the deployment command:
```bash
npm run deploy
```

This script will:
- Build the React application with production settings
- Upload static assets to S3 with appropriate caching headers
- Upload HTML and configuration files with no-cache headers
- Set proper content types for all files
- Create a CloudFront invalidation to update the CDN
- Monitor the invalidation process until completion

### Manual Deployment

If you need to deploy manually without using the script:

1. Build the application:
```bash
npm run build
```

2. Upload files to S3:
```bash
aws s3 sync build/ s3://dee-en-eh-react-app --delete
```

3. Invalidate CloudFront cache:
```bash
aws cloudfront create-invalidation --distribution-id E3QB86OHQX5C36 --paths "/*"
```

### Troubleshooting Deployment Issues

If you encounter issues with the deployment:

1. Check AWS CLI credentials and permissions
2. Verify the S3 bucket name and region in the deployment script
3. Ensure the CloudFront distribution ID is correct
4. Check browser console for any CORS or loading errors
5. Verify S3 bucket permissions and CORS configuration