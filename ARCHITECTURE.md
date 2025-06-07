# Digital DNA System Architecture

This document provides a comprehensive overview of the Digital DNA application architecture, focusing on the data processing pipeline, authentication flow, and API integrations.

## System Overview

The Digital DNA application is a serverless system that processes user data exports to extract valuable insights and build personalized user profiles. It consists of multiple AWS Lambda functions orchestrated to create a multi-stage data processing pipeline.

## Data Processing Pipeline

### Pipeline Stages

The pipeline processes data through multiple stages:

1. **Stage 1 (Raw Data)** - `<userEmail>/stage1/`
   - Contains raw, unprocessed data files uploaded by users
   - Includes CSV, PDF, JSON files from various data sources
   - Processed by: `data-preprocessor.js`

2. **Preprocessed Data** - `<userEmail>/preprocessed/`
   - Contains cleaned, normalized data with consistent format
   - JSON files with standardized schema for each data type
   - Processed by: `categorize-user-data.js` and `user-profile-builder.js`

3. **Stage 2 (Categorized Data)** - `<userEmail>/stage2/`
   - Contains categorized data with AI-extracted information
   - Includes category tags, entities, and structured insights
   - Also includes the master user profile (`user_master_profile.json`)
   - Processed by: `persona-builder.js`

4. **Stage 3 (User Insights)** - `<userEmail>/stage3/`
   - Contains high-level user insights and personas
   - Includes visualization-ready data for the UI
   - Final output used by frontend application

### Lambda Functions

The pipeline consists of these main Lambda functions:

1. **Data Processing Orchestrator** (`data-processing-orchestrator.js`)
   - Central coordinator for the entire pipeline
   - Triggered by S3 file uploads across all stages
   - Routes files to appropriate processors based on stage
   - Implements rate limiting for OpenAI API calls
   - Manages concurrent processing to prevent API overload

2. **Data Preprocessor** (`data-preprocessor.js`)
   - Processes raw data files from stage1
   - Normalizes different file formats (CSV, PDF, JSON)
   - Extracts meaningful data and removes noise
   - Outputs standardized JSON to the preprocessed directory

3. **Data Categorizer** (`categorize-user-data.js`)
   - Processes files from the preprocessed stage
   - Uses OpenAI API to categorize and extract insights
   - Applies business rules to structure the data
   - Outputs categorized files to stage2

4. **User Profile Builder** (`user-profile-builder.js`)
   - Processes files from the preprocessed stage
   - Extracts hard metrics and numerical facts from data
   - Aggregates metrics across multiple files
   - Builds a comprehensive user profile with quantitative insights
   - Outputs `user_master_profile.json` to stage2

5. **Persona Builder** (`persona-builder.js`)
   - Processes files from stage2, including the user profile
   - Generates high-level user personas and insights
   - Creates visualization-ready data for the UI
   - Outputs insights to stage3

### Data Flow Diagram

```
┌───────────┐     ┌───────────────────┐     ┌────────────────────┐
│  User UI  │────▶│ S3 Upload (stage1)│────▶│ data-preprocessor  │
└───────────┘     └───────────────────┘     └────────────────────┘
                                                      │
                          ┌─────────────────────────────────────────┐
                          │                                         │
                          ▼                                         ▼
┌─────────────────────────┐                            ┌────────────────────────┐
│    preprocessed data    │                            │ categorize-user-data   │
└─────────────────────────┘                            └────────────────────────┘
          │                                                        │
          ▼                                                        ▼
┌───────────────────────┐                              ┌────────────────────────┐
│ user-profile-builder  │                              │      stage2 data       │
└───────────────────────┘                              └────────────────────────┘
          │                                                        │
          ▼                                                        ▼
┌───────────────────────┐                              ┌────────────────────────┐
│ user_master_profile   │◀─────────────────────────────│    persona-builder     │
└───────────────────────┘                              └────────────────────────┘
                                                                   │
                                                                   ▼
                                                      ┌────────────────────────┐
                                                      │      stage3 data       │
                                                      └────────────────────────┘
                                                                   │
                                                                   ▼
                                                      ┌────────────────────────┐
                                                      │  Frontend Application  │
                                                      └────────────────────────┘
```

## Rate Limiting Implementation

To handle OpenAI API rate limits, the system implements several rate limiting strategies:

1. **Orchestrator-Level Rate Limiting**
   - Tracks active processing counts per user and stage
   - Limits concurrent OpenAI API calls (MAX_CONCURRENT_OPENAI_CALLS)
   - Applies staggered delays between API calls
   - Scales delay based on active processing count

2. **Lambda-Level Processing Controls**
   - Sequential batch processing instead of parallel
   - Staggered delays between file processing
   - Batch size limits to control memory usage

## Authentication Flow

The system uses Google OAuth for authentication:

1. **Frontend Authentication**
   - User authenticates with Google OAuth
   - Receives ID token from Google

2. **API Authentication**
   - Frontend passes Google ID token to API Gateway
   - Custom JWT authorizer (`google-jwt-authorizer.js`) validates token
   - On successful validation, user gets temporary AWS credentials

3. **AWS Credentials**
   - `get-aws-credentials.js` issues temporary S3 credentials
   - Credentials are scoped to user's own directory in S3
   - Frontend uses credentials for direct S3 uploads

```
┌───────────┐    ┌───────────────┐    ┌───────────────────┐
│  User UI  │───▶│ Google OAuth  │───▶│ Google ID Token   │
└───────────┘    └───────────────┘    └───────────────────┘
                                               │
                                               ▼
┌───────────────────────┐    ┌───────────────────────────┐
│ Temporary S3 Creds    │◀───│ google-jwt-authorizer.js  │
└───────────────────────┘    └───────────────────────────┘
          │
          ▼
┌───────────────────────┐
│ Direct S3 Upload      │
└───────────────────────┘
```

## API Integration

The application exposes several API endpoints through API Gateway:

1. **Authentication API**
   - `/auth/google` - Validates Google tokens and issues AWS credentials
   - `/auth/verify` - Verifies current credentials

2. **Data Processing API**
   - `/user/data/categorize` - Triggers manual categorization
   - `/user/data/metrics` - Retrieves user metrics
   - `/user/profile` - Retrieves and updates user profile

3. **Admin API**
   - `/admin/prompts` - Manages system prompts
   - `/admin/system` - System administration functions

## Deployment

The application is deployed using several scripts:

1. **Lambda Deployment**
   - `deploy-lambda-all.sh` - Deploys all Lambda functions
   - `deploy-lambda-function.sh` - Deploys individual Lambda function

2. **API Configuration**
   - `configure-all-apis.sh` - Configures all API endpoints
   - Individual API configuration scripts for specific endpoints

3. **S3 Event Configuration**
   - S3 event notifications to trigger the orchestrator
   - Custom event configurations for specific Lambdas

## Monitoring and Logging

- CloudWatch logs for all Lambda functions
- Error tracking and reporting
- Performance metrics for pipeline stages

## Future Improvements

1. **Enhanced Rate Limiting**
   - Implement queue-based processing for large volumes
   - Use Step Functions for more resilient orchestration

2. **Advanced Monitoring**
   - Create CloudWatch dashboards for pipeline performance
   - Set up alarms for rate limit errors and failures

3. **Optimization**
   - Optimize memory usage for large file processing
   - Implement caching for frequent API calls