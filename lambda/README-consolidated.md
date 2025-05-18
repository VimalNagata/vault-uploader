# Digital DNA Lambda Functions

This repository contains all AWS Lambda functions for the Digital DNA application, a platform for users to upload, organize, and analyze their personal data from tech platforms (CCPA/GDPR data exports).

## Architecture Overview

The Digital DNA backend consists of the following components:

- **Authentication & Authorization Services**
  - Google authentication for users
  - Temporary AWS credentials for S3 access
  - JWT validation for API security

- **Data Processing Pipeline**
  - File upload and preprocessing
  - Data categorization and analysis
  - Persona building and insights

- **API Gateway**
  - Secured REST endpoints for frontend integration
  - CORS support for web applications

- **Storage**
  - S3 buckets with structured paths for user data
  - Multi-stage data organization

## Lambda Functions

### Authentication & Authorization

1. **get-aws-credentials.js**
   - Generates temporary AWS credentials for authenticated users
   - Limited scope to user's own S3 folder
   - Secures user data with temporary session tokens

2. **google-jwt-authorizer.js**
   - Validates Google JWT tokens for API Gateway
   - Extracts user information from tokens
   - Provides user context for other Lambda functions

### Data Access

3. **get-user-data-metrics.js**
   - Retrieves file metrics and organization from S3
   - Provides file tree structure for UI
   - Optimized for large data sets with summary options

### Data Processing Pipeline

4. **data-processing-orchestrator.js**
   - Central entry point for the processing pipeline
   - Routes files based on storage stage
   - Manages cross-stage dependencies

5. **data-preprocessor.js**
   - PDF to text conversion
   - Large file chunking with overlap
   - Prepares data for AI analysis

6. **categorize-user-data.js**
   - Analyzes file content using OpenAI
   - Classifies data into categories (financial, social, etc.)
   - Extracts structured information from unstructured data

7. **persona-builder.js**
   - Builds comprehensive user personas
   - Aggregates insights across data sources
   - Creates a holistic view of user data

## Data Flow & Storage Structure

The application organizes data into stages:

```
<userEmail>/
  ├── stage1/          # Raw uploads (YOUR_DATA)
  │
  ├── preprocessed/    # Preprocessed data (PDF conversion, chunking)
  │  
  ├── stage2/          # Categorized data (ANALYZED_DATA)
  │
  └── stage3/          # Insights & personas (INSIGHTS)
```

The data flows through the system as follows:

1. **Upload**: User uploads files to `stage1/`
2. **Preprocessing**: Files are converted and chunked in `preprocessed/`
3. **Categorization**: Files are analyzed and categorized in `stage2/`
4. **Persona Building**: Insights are aggregated into `stage3/`

## Deployment

### Prerequisites

- AWS CLI installed and configured
- Node.js and npm installed
- An S3 bucket for storing user data
- Google OAuth Client ID
- OpenAI API key for AI processing

### IAM Setup

Each Lambda requires specific permissions. See [IAM_SETUP_INSTRUCTIONS.md](./IAM_SETUP_INSTRUCTIONS.md) for detailed setup instructions.

### Unified Deployment Script

The repository includes a unified deployment script (`deploy.sh`) that can deploy individual functions or the entire system:

```bash
# Deploy all Lambda functions
./deploy.sh all

# Deploy only the data processing pipeline
./deploy.sh pipeline

# Deploy authentication Lambdas
./deploy.sh auth

# Deploy a specific Lambda function
./deploy.sh get-user-data-metrics

# Create a new Lambda (instead of updating)
./deploy.sh categorize-user-data --create

# Configure and deploy API Gateway
./deploy.sh all --configure-api --deploy-api
```

### Environment Variables

Set these environment variables before deployment:

```bash
# Required for all deployments
export S3_BUCKET_NAME=your-bucket-name

# Required for AI-powered functions
export OPENAI_API_KEY=your-openai-api-key

# Optional: Google OAuth Client ID
export GOOGLE_CLIENT_ID=your-google-client-id

# Optional: Default AWS region
export AWS_REGION=us-east-1
```

## Function Details

### Data Preprocessing

The preprocessor handles:

- **PDF Conversion**: Converts PDF files to text for AI processing
- **Large File Chunking**: Splits files into ~20KB chunks with 2KB overlap
- File preparation for the AI categorization stage

See [README-preprocessing.md](./README-preprocessing.md) for implementation details.

### Data Categorization

The categorization process:

- Analyzes file content with OpenAI
- Classifies data into categories:
  - Financial (transactions, banking, subscriptions)
  - Social (connections, interactions)
  - Professional (work history, education)
  - Entertainment (media consumption, preferences)
- Generates structured JSON summaries

See [README-categorize.md](./README-categorize.md) for implementation details.

### Persona Building

The persona builder creates comprehensive profiles:

- Built from categorized data
- Updates incrementally as new files are processed
- Organizes insights by persona type
- Maintains history of data sources

## Metrics Optimization

The metrics Lambda is optimized for:

- Fast dashboard loading with summary mode
- Stage-specific file viewing
- Efficient payload sizes
- Categorized data summaries

Use these query parameters for optimization:
- `summaryOnly=true`: Returns only metrics without file details
- `stageFilter=stage1`: Returns files only from a specific stage
- `skipFileTree=true`: Omits the file tree structure when not needed

## Troubleshooting

If you encounter issues:

1. **Check CloudWatch Logs** for error messages
2. **Verify IAM permissions** for Lambda roles
3. **Test API endpoints** using the AWS console
4. **Confirm environment variables** are set correctly
5. **Verify S3 event notifications** are correctly configured

## Security Best Practices

This implementation follows security best practices:

1. **JWT Validation**: Rigorous token validation
2. **Temporary Credentials**: Limited scope and duration
3. **IAM Best Practices**: Least privilege principle
4. **CORS Configuration**: Restrict to application domains
5. **Rate Limiting**: Protect against abuse
6. **Input Validation**: Sanitize all user input
7. **Error Handling**: Prevent information disclosure