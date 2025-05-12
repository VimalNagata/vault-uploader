# Digital DNA Data Processing Pipeline

This document describes the end-to-end data processing pipeline for Digital DNA, which processes user data through multiple stages and builds comprehensive user personas.

## Overview

The pipeline consists of three main components:

1. **Orchestrator Lambda** (`data-processing-orchestrator.js`)
   - Entry point for all S3 file events
   - Routes files to the appropriate processor based on path
   - Manages cross-stage dependencies

2. **Stage 1 Processor** (`categorize-user-data.js`)
   - Processes raw data files in `stage1`
   - Uses OpenAI to analyze and categorize data
   - Stores results in `stage2` as JSON metadata

3. **Stage 2 Processor** (`persona-builder.js`)
   - Processes categorized data from `stage2`
   - Builds and updates user personas
   - Stores persona data in `stage3`

## Data Flow

```
S3 Upload (stage1/) → Orchestrator → Categorizer → JSON in stage2/
                                   ↓
                        JSON Upload (stage2/) 
                                   ↓
                        Orchestrator → Persona Builder → Personas in stage3/
```

## Deployment

To deploy the entire pipeline:

```bash
# Set required environment variables
export S3_BUCKET_NAME=your-bucket-name
export OPENAI_API_KEY=your-openai-api-key

# Run the deployment script
./deploy-processing-pipeline.sh
```

This will:
1. Build Lambda packages
2. Deploy all Lambda functions
3. Configure IAM permissions
4. Set up S3 event notifications
5. Configure API Gateway endpoints

## Lambda Functions

### 1. Data Processing Orchestrator

**Purpose**: Routes data to appropriate processor based on stage.

**Triggers**:
- S3 object creation events (prefix: `*/stage*`)

**Environment Variables**:
- `S3_BUCKET_NAME`: The S3 bucket name

**Behavior**:
- If file is in `stage1`, routes to `categorize-user-data`
- If file is in `stage2`, routes to `persona-builder`
- Skips files larger than 10MB for automatic processing

### 2. Categorize User Data

**Purpose**: Analyzes and categorizes raw user data exports.

**Triggers**:
- Via Orchestrator
- Directly through API Gateway
- (Optionally) S3 object creation in `stage1`

**Environment Variables**:
- `S3_BUCKET_NAME`: The S3 bucket name
- `OPENAI_API_KEY`: OpenAI API key

**Behavior**:
- Gets file content from S3
- Sends to OpenAI for categorization
- Extracts financial, social, professional, entertainment data
- Creates JSON summary in `stage2`

### 3. Persona Builder

**Purpose**: Creates and updates user personas based on categorized data.

**Triggers**:
- Via Orchestrator
- Directly through API Gateway

**Environment Variables**:
- `S3_BUCKET_NAME`: The S3 bucket name
- `OPENAI_API_KEY`: OpenAI API key

**Behavior**:
- Reads categorized data from `stage2`
- Gets existing personas from `stage3` or creates new ones
- Uses OpenAI to update personas with new data
- Saves updated personas to `stage3/personas.json`

## S3 Structure

```
<userEmail>/
  ├── stage1/       # Raw data uploads
  │   ├── file1.csv
  │   └── file2.json
  │
  ├── stage2/       # Categorized data (generated)
  │   ├── file1.csv.json
  │   └── file2.json.json
  │
  └── stage3/       # Personas (generated)
      └── personas.json
```

## Persona Structure

The personas are stored in a single JSON file with this structure:

```json
{
  "financial": {
    "type": "financial",
    "name": "Financial Profile",
    "lastUpdated": "2023-05-12T15:30:45.123Z",
    "completeness": 65,
    "summary": "User has accounts with...",
    "insights": ["Spends heavily on travel"],
    "dataPoints": ["Bank account at Chase", "Credit card with Amex"],
    "traits": {
      "spendingHabits": "Moderate",
      "financialServices": ["Chase", "Amex"],
      "subscriptions": ["Netflix", "Spotify"]
    },
    "sources": ["transactions.csv", "subscriptions.json"]
  },
  "social": {
    // Same structure as above but for social data
  }
  // ... other persona types
}
```

## Implementation Details

### IAM Permissions

The pipeline requires these IAM permissions:

1. **Orchestrator**:
   - Lambda invoke permissions for stage processors
   - S3 read for detecting file size

2. **Stage Processors**:
   - S3 read/write to appropriate buckets and paths
   - Lambda basic execution role

### Error Handling

- Each Lambda logs comprehensive error details
- Orchestrator continues processing if one file fails
- Failed stage1 files won't block stage2 file processing

### Parallelization

- Orchestrator processes multiple file uploads in parallel
- Each Lambda processes files asynchronously if invoked directly by S3

## Monitoring and Logs

All Lambda functions log to CloudWatch with detailed information about:
- File paths being processed
- Processing stages
- Error details and contexts
- API responses and outputs

## Extending the Pipeline

To add a new stage processor:

1. Create a new Lambda function
2. Update the orchestrator to route to the new processor
3. Add IAM permissions for the new processor
4. Update the deployment script