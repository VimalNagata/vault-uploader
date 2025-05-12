# File Categorization with OpenAI

This README explains how to set up the Lambda function for categorizing user data with OpenAI.

## Overview

The `categorize-user-data` Lambda function analyzes files uploaded to S3 using OpenAI to extract relevant information and categorize it. This data is stored in stage2 of the S3 bucket in JSON format.

## Requirements

- AWS account with Lambda and S3 access
- OpenAI API key
- Existing S3 bucket with stage1 folder structure

## Lambda Function Setup

### 1. Configure Environment Variables

The Lambda function requires the following environment variables:

- `S3_BUCKET_NAME`: The name of your S3 bucket 
- `OPENAI_API_KEY`: Your OpenAI API key

### 2. Deploy the Lambda Function

Deploy the Lambda function to AWS:

```bash
# Set your environment variables
export S3_BUCKET_NAME=your-bucket-name
export OPENAI_API_KEY=your-openai-api-key

# Deploy the Lambda function
./deploy-lambda.sh categorize-user-data --create
```

### 3. Configure API Gateway

Set up the API Gateway endpoint for the Lambda function:

```bash
./configure-categorize-api.sh --deploy
```

This creates a POST endpoint at `/categorize` in your API Gateway.

### 4. Set Up S3 Event Trigger (Optional)

For automatic processing of small files, set up an S3 event trigger:

```bash
# Replace ACCOUNT_ID in s3-event-trigger.json with your actual AWS account ID

# Create the S3 event notification
aws s3api put-bucket-notification-configuration \
  --bucket your-bucket-name \
  --notification-configuration file://s3-event-trigger.json
```

## Frontend Integration

The frontend can trigger file categorization using the S3Service in the application:

```typescript
// Categorize a file
const result = await S3Service.categorizeFile(
  username,
  filePath,
  fileName
);
```

## Behavior

- When a user selects a file in the Raw Data page, they can click "Analyze with AI"
- The Lambda function retrieves the file content from S3
- It sends the content to OpenAI for analysis
- The structured results are stored as JSON in the user's stage2 folder
- The categorization includes:
  - File type identification
  - Content summary
  - Category relevance scores
  - Key data points
  - Insights
  - Sensitive information flag

## Troubleshooting

If categorization fails:

1. Check Lambda logs in CloudWatch
2. Verify environment variables are set correctly
3. Ensure the S3 bucket permissions allow the Lambda to read from stage1 and write to stage2
4. Check OpenAI API key validity and rate limits
5. For large files, they may need to be processed in chunks

## Extensions

Future improvements could include:

- Batch processing for multiple files
- Category-specific analysis pipelines
- Integration with personalization features
- Language-specific processing based on file content