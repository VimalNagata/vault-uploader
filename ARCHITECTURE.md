# Digital DNA Architecture

This document provides a comprehensive overview of the Digital DNA application architecture, covering both frontend and backend components, data flows, and processing pipelines.

## System Overview

Digital DNA is a platform that allows users to upload and analyze their personal data exports from various platforms (CCPA/GDPR data). The system processes this raw data, categorizes it, builds user profiles, and generates insights.

## Architecture Diagram

```
                         Frontend & Authentication
+---------------+     +----------------+      +-----------------------+
|               |     |                |      |                       |
|  React        |---->|  API Gateway   |----->|  get-aws-credentials  |
|  Frontend     |<----|                |<-----|  Lambda (temp creds)  |
|  Components:  |     |                |      |                       |
|  - Dashboard  |     |                |      +-----------------------+
|  - File Upload|     |                |                
|  - Auth       |     |                |      +-----------------------+
|  - User Profile|    |                |----->|                       |
+---------------+     +----------------+      |  google-jwt-authorizer|
       |                     ^                |  Lambda               |
       |                     |                |                       |
       |                     |                +-----------------------+
       |                     |                                
       v                     |                                
+---------------+            |                                
|               |            |                                
|  Google       |------------+                                
|  OAuth        |                                            
|  (External)   |                                            
+---------------+                                            

+---------------+                                                       
|               |                                                       
|  User's       |-------> Direct S3 uploads with pre-signed URLs        
|  Browser      |                     |                                
|               |                     |                                
+---------------+                     v                                
                                 +----------------+
                                 |                |
                                 |  S3 Bucket     |
                                 |  stage1/       |---+
                                 |  (raw files)   |   |
                                 |                |   |
                                 +----------------+   |
                                                      |
                                                      | S3 Event
                                                      | Trigger
                                                      v
                           +--------------------------------+
                           |                                |
                           | data-processing-orchestrator   |
                           | Lambda                         |
                           |                                |
                           | Routes files to appropriate    |
                           | processor based on path/stage  |
                           +--------------------------------+
                                 |            |            |
                                 |            |            |
             +-----------------+ |            |            | +--------------------+
             |                 | |            |            | |                    |
             v                 v v            v            v v                    v
   +----------------+  +----------------+  +----------------+  +----------------+
   |                |  |                |  |                |  |                |
   | preprocessed/  |  | data-          |  | categorize-    |  | persona-       |
   | (chunked &     |--| preprocessor   |  | user-data      |  | builder        |
   |  converted)    |  | Lambda         |  | Lambda         |  | Lambda         |
   |                |  |                |  |                |  |                |
   +----------------+  +----------------+  +----------------+  +----------------+
           |                                        |                  |
           |                                        |                  |
           |                                        v                  |
           |                               +----------------+          |
           |                               |                |          |
           |                               | stage2/        |----------+
           |                               | (categorized   |
           |                               |  data)         |
           |                               |                |
           |                               +----------------+
           |                                        
           |                                        
           |           +---------------------+      
           |           |                     |      
           +---------->| user-profile-       |      
                       | builder Lambda      |      
                       | (direct processing) |      
                       |                     |      
                       +---------------------+      
                                |                  
                                v                  
                       +----------------+         
                       |                |         
                       | user_master_   |         
                       | profile.json   |         
                       | - Hard facts   |         
                       | - Aggregates   |         
                       | - Time-series  |         
                       | - No categories|         
                       +----------------+         
                                |                  
                                v                  
                       +----------------+         
                       |                |         
                       | stage3/        |         
                       | (insights &    |         
                       |  personas)     |         
                       |                |         
                       +----------------+
```

## Architecture Explanation

The Digital DNA application employs a modern serverless architecture with two main components: the authentication system and the data processing pipeline.

### Authentication Flow

1. Users access the React frontend, which initiates authentication with Google OAuth
2. After successful authentication, Google provides a JWT token to the frontend
3. For API access, the frontend sends this token in the Authorization header
4. The `google-jwt-authorizer` Lambda validates this token with Google's services
5. For file uploads, the frontend calls the `get-aws-credentials` Lambda (which requires authentication)
6. This Lambda returns temporary S3 credentials scoped to the user's email prefix
7. The browser uses these credentials to upload files directly to S3, bypassing size limitations

### Data Processing Pipeline

The data processing pipeline consists of multiple stages, each with dedicated storage locations and Lambda functions:

1. **Stage 1: Raw Data Collection**
   - Storage: `<userEmail>/stage1/` in S3
   - Files: Original user uploads (PDFs, ZIPs, CSVs, etc.)
   - Trigger: S3 upload event → `data-processing-orchestrator`
   - Action: Orchestrator routes to `data-preprocessor`

2. **Preprocessing Stage**
   - Storage: `<userEmail>/preprocessed/` in S3
   - Files: Converted text files, chunked documents
   - Lambda: `data-preprocessor.js` - Handles PDF conversion, large file chunking
   - Trigger: New preprocessed file → `data-processing-orchestrator`
   - Action: Orchestrator routes to `categorize-user-data`

3. **Stage 2: Data Categorization**
   - Storage: `<userEmail>/stage2/` in S3
   - Files: JSON files with categorized data, entity extraction
   - Lambda: `categorize-user-data.js` - Uses OpenAI to analyze content
   - Trigger: New categorized file → `data-processing-orchestrator`
   - Action: Orchestrator routes to both `user-profile-builder` and `persona-builder`

4. **User Profile Building (Revised Approach)**
   - Storage: `<userEmail>/stage2/user_master_profile.json` in S3
   - Lambda: `user-profile-builder.js` - Processes preprocessed files directly
   - Process: 
     - Reads preprocessed files instead of categorized files
     - Uses OpenAI to extract hard facts and metrics directly
     - Focuses on numeric aggregations (totals, averages, maximums)
     - Generates time-based metrics (e.g., monthly spending on rides)
     - Excludes category information, focusing only on quantitative data
   - Output: Consolidated user profile JSON with fact-based metrics

5. **Stage 3: Insights Generation**
   - Storage: `<userEmail>/stage3/` in S3
   - Files: Persona documents, insight collections
   - Lambda: `persona-builder.js` - Creates high-level insights
   - Input: Uses categorized data and master profile
   - Output: Actionable insights and user personas

### Orchestration

The `data-processing-orchestrator.js` Lambda is the central coordinator of the pipeline:

1. It's triggered by S3 events when files are added to any stage
2. It examines the path to determine which stage the file belongs to
3. Based on the stage, it invokes the appropriate Lambda function
4. It handles error conditions and ensures proper flow between stages
5. It can trigger multiple Lambdas in parallel when appropriate (e.g., profile building and persona generation)

This event-driven, orchestrator-based architecture provides several advantages:
- Independent scaling of each processing component
- Automatic progression through the pipeline
- Clear separation of concerns between stages
- Resilience through retries and error handling
- Easy addition of new pipeline components

All user data is isolated by email prefix in S3, ensuring security and privacy throughout the process.

## Frontend Architecture

### Key Components

1. **Authentication Module**
   - Uses Google OAuth for authentication
   - Handles user login/logout
   - Manages JWT tokens and session state

2. **File Management**
   - S3 file uploader component
   - File browser and navigator
   - Direct S3 integration using pre-signed URLs

3. **User Dashboard**
   - Data visualization components
   - Summary statistics
   - User profile view

4. **Admin Module**
   - Prompt management interface
   - System configuration options

### Data Flow (Frontend)

1. **User Authentication**
   - User logs in with Google credentials
   - Frontend obtains JWT token
   - Token is used for all subsequent API calls

2. **File Upload**
   - User selects files for upload
   - Frontend requests temporary S3 credentials
   - Files are directly uploaded to the user's S3 folder
   - Upload progress is tracked and reported to user
   - Upload completion triggers processing pipeline

3. **Data Viewing**
   - Dashboard retrieves metrics and summaries via API
   - Raw data is loaded directly from S3 when needed
   - User can navigate through categorized data
   - User profile and insights are fetched from processed data

## Backend Architecture

### Components

1. **API Gateway Layer**
   - REST API endpoints for frontend integration
   - JWT authentication/authorization
   - Request validation and routing

2. **Lambda Functions**
   - Stateless, event-driven processing
   - Specialized functions for each stage of processing
   - Triggered by API calls, S3 events, or other Lambdas

3. **S3 Storage**
   - User data organized by email and processing stage
   - Hierarchical storage model
   - Centralized prompt templates and configuration

4. **Orchestration**
   - Data processing orchestrator for workflow management
   - Event-based triggers between processing stages

### Processing Pipeline

The backend implements a multi-stage data processing pipeline:

#### Stage 1: Raw Data Collection
- **Entry Point**: User uploads files to S3 `<userEmail>/stage1/`
- **Function**: `data-preprocessor.js`
- **Processing**: 
  - Converts PDFs to text
  - Chunks large files
  - Prepares data for analysis
- **Output**: Preprocessed files in `<userEmail>/preprocessed/`

#### Stage 2: Data Categorization
- **Entry Point**: Preprocessed files in `<userEmail>/preprocessed/`
- **Function**: `categorize-user-data.js`
- **Processing**:
  - Analyzes file content using OpenAI
  - Classifies data into categories (financial, social, etc.)
  - Extracts structured information
- **Output**: Categorized data files in `<userEmail>/stage2/`

#### Stage 2a: User Profile Building
- **Entry Point**: Categorized files in `<userEmail>/stage2/`
- **Function**: `user-profile-builder.js`
- **Processing**:
  - Aggregates data across all categorized files
  - Builds comprehensive user profile
  - Consolidates metrics and insights
- **Output**: Master user profile in `<userEmail>/stage2/user_master_profile.json`

#### Stage 3: Persona Generation
- **Entry Point**: User profile and categorized data
- **Function**: `persona-builder.js`
- **Processing**:
  - Generates insights and patterns
  - Creates a comprehensive user persona
  - Identifies trends and recommendations
- **Output**: Persona data in `<userEmail>/stage3/`

### Event Flows

1. **S3 Upload Trigger**
   - New file in `stage1/` → Triggers `data-processing-orchestrator`
   - Orchestrator routes to `data-preprocessor`
   - Preprocessor outputs to `preprocessed/`

2. **Preprocessing Completion**
   - New file in `preprocessed/` → Triggers `data-processing-orchestrator`
   - Orchestrator routes to `categorize-user-data`
   - Categorizer outputs to `stage2/`

3. **Categorization Completion**
   - New file in `stage2/` → Triggers `data-processing-orchestrator`
   - Orchestrator routes to both:
     - `user-profile-builder` (for profile aggregation)
     - `persona-builder` (for persona generation)

4. **Manual API Triggers**
   - API Gateway → Lambda direct invocation
   - Used for on-demand processing, testing, or admin functions

## Data Structure

### S3 Organization

```
bucket/
├── prompt-templates/
│   └── prompts.json
│
├── <userEmail>/
│   ├── stage1/                  # Raw uploaded files
│   │   ├── facebook_export.zip
│   │   └── google_takeout.pdf
│   │
│   ├── preprocessed/            # Preprocessed files
│   │   ├── facebook_export.json
│   │   └── google_takeout.txt
│   │
│   ├── stage2/                  # Categorized data
│   │   ├── facebook_export.json
│   │   ├── google_takeout.json
│   │   └── user_master_profile.json
│   │
│   └── stage3/                  # Generated personas and insights
│       └── user_persona.json
```

### User Master Profile Structure

The user master profile is a comprehensive JSON document containing:

- Demographics (name, age, location)
- Financial metrics (income, spending, assets)
- Professional information (job, skills, education)
- Social metrics (connections, platforms used)
- Health metrics (conditions, exercise patterns)
- Travel metrics (trips, destinations)
- Technology usage (devices, software)
- Interests and preferences

## API Endpoints

1. **Authentication**
   - `GET /credentials` - Get temporary AWS credentials for S3 access

2. **Data Processing**
   - `POST /categorize` - Manually trigger categorization for a file
   - `POST /user-profile` - Manually trigger user profile building
   - `GET /user-data-metrics` - Get metrics about user's data

3. **Admin**
   - `GET /prompt-manager` - List available prompts
   - `POST /prompt-manager` - Create/update prompts
   - `DELETE /prompt-manager` - Delete prompts

## Security

1. **Authentication**
   - Google OAuth 2.0 for user authentication in the frontend
   - Frontend obtains Google JWT tokens after successful authentication
   - These tokens are sent with API requests in the Authorization header
   - No AWS Cognito used - authentication is handled entirely by Google
   - Both Google ID tokens and access tokens are supported
   - The flow is:
     1. User authenticates with Google in the browser
     2. Frontend receives Google JWT token
     3. Token is sent with API requests
     4. API Gateway invokes Custom JWT Authorizer Lambda
     5. Authorizer validates token with Google and allows/denies access

2. **Authorization**
   - Custom JWT authorizer Lambda (`google-jwt-authorizer.js`) for API Gateway
   - The authorizer Lambda functions as follows:
     - Extracts JWT token from Authorization header
     - Verifies the token using Google's authentication libraries
     - Checks for valid email claim and email verification
     - Generates IAM policy document allowing/denying API access
     - Passes user email and profile info to downstream Lambdas
   - IAM roles with least privilege for Lambda execution
   - S3 bucket policies for user isolation
   - Email-based user isolation in data storage

3. **Data Protection**
   - User data isolation by email prefix
   - No cross-user data access
   - Encrypted data at rest and in transit

## Development and Deployment

1. **Local Development**
   - React frontend with hot reloading
   - Local testing of Lambda functions
   - Environment variables for configuration

2. **Deployment**
   - Frontend build and deployment to hosting
   - Lambda packaging and deployment scripts
   - API Gateway configuration scripts

## Future Enhancements

1. **Scalability Improvements**
   - Enhanced caching strategy
   - Parallel processing for large files
   - Performance optimizations

2. **Feature Additions**
   - Support for more data source types
   - Enhanced visualization options
   - Machine learning for better insights

3. **Security Enhancements**
   - Multi-factor authentication
   - Enhanced audit logging
   - Advanced data access controls