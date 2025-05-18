# Lambda Deployment Scripts

This directory contains shell scripts for building, configuring, and deploying Lambda functions for the Digital DNA application.

## Script Overview

### Main Scripts

- **deploy.sh** - Master deployment script for all Lambda functions
  - Unified interface for deploying all Lambda functions with various options
  - Supports updating, creating, or deploying individual functions or the entire suite
  - Controls API Gateway deployment and configuration

- **deploy-lambda-function.sh** - Quick deployment script for a single Lambda function
  - Streamlined script for updating an existing Lambda function
  - Mainly used for quick updates during development

### Build Scripts

- **build-lambdas.sh** - Builds Lambda function packages
  - Creates zip archives for Lambda deployment
  - Handles dependency management and packaging

### Configuration Scripts

- **configure-api-gateway.sh** - Configures AWS API Gateway
  - Sets up API Gateway with appropriate routes, authorizers, and methods
  - Creates and configures the main API for the application

- **configure-categorize-api.sh** - Configures the categorization API
  - Sets up API Gateway specifically for the categorization Lambda function
  - Handles CORS configuration and authorization

- **create-lambda-skeleton.sh** - Creates a new Lambda function from a template
  - Generates a skeleton Lambda function with proper configuration
  - Sets up IAM roles and permissions

## Usage Examples

### Deploy All Lambda Functions

```bash
./deploy.sh --all
```

### Update a Single Lambda Function

```bash
./deploy.sh --function get-user-data-metrics
```

or use the simplified script:

```bash
./deploy-lambda-function.sh get-user-data-metrics
```

### Create and Deploy a New API

```bash
./deploy.sh --all --create-api --deploy-api
```

## Documentation

For more detailed information about Lambda function deployment and configuration, see:

- [../README.md](../README.md) - Main Lambda documentation
- [../README-consolidated.md](../README-consolidated.md) - Comprehensive guide to the Lambda backend