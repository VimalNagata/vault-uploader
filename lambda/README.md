# Digital DNA Lambda Functions

All Lambda functions have been consolidated into a single README. Please see [README-consolidated.md](./README-consolidated.md) for complete documentation.

## Project Organization

- **Lambda Functions** - JavaScript files in the root directory
- **Scripts** - All deployment and configuration scripts in the [scripts/](./scripts/) directory
- **Distribution** - Built Lambda packages in the [dist/](./dist/) directory

## Quick Start

Two options for deploying Lambda functions:

### Option 1: Comprehensive Deployment Script

Use the unified deployment script for complete setup and management:

```bash
# Deploy all Lambda functions
./scripts/deploy.sh all

# Deploy a specific Lambda function
./scripts/deploy.sh <function-name>

# Create a new Lambda function
./scripts/deploy.sh <function-name> --create

# Get help
./scripts/deploy.sh --help
```

### Option 2: Quick Update Script

For quick updates to existing Lambda functions:

```bash
# Update a specific Lambda function
./scripts/deploy-lambda-function.sh <function-name>
```

## Function Overview

1. **Authentication & Authorization**
   - [get-aws-credentials.js](./get-aws-credentials.js): Generates temporary AWS credentials
   - [google-jwt-authorizer.js](./google-jwt-authorizer.js): Validates Google JWT tokens

2. **Data Access**
   - [get-user-data-metrics.js](./get-user-data-metrics.js): Retrieves file metrics and structure

3. **Data Processing Pipeline**
   - [data-processing-orchestrator.js](./data-processing-orchestrator.js): Orchestrates processing
   - [data-preprocessor.js](./data-preprocessor.js): Converts PDFs and chunks large files
   - [categorize-user-data.js](./categorize-user-data.js): Analyzes data with OpenAI
   - [persona-builder.js](./persona-builder.js): Builds comprehensive user personas

4. **Helper Scripts** (in [scripts/](./scripts/) directory)
   - [scripts/build-lambdas.sh](./scripts/build-lambdas.sh): Builds deployment packages
   - [scripts/configure-api-gateway.sh](./scripts/configure-api-gateway.sh): Configures API Gateway
   - [scripts/configure-categorize-api.sh](./scripts/configure-categorize-api.sh): Configures categorize API
   - [scripts/deploy.sh](./scripts/deploy.sh): Unified deployment script

For detailed documentation, see [README-consolidated.md](./README-consolidated.md).

## Scripts Directory

All shell scripts have been organized in the [scripts/](./scripts/) directory for better project organization. See [scripts/README.md](./scripts/README.md) for details about each script.