# Prompt Management System

This document explains the prompt management system for the CCPA Uploader application. This system allows admins to view and modify the prompts used by the OpenAI API.

## Overview

Prompts are stored in the S3 bucket in a dedicated `prompt-templates` directory, separate from user data. Admins can view and modify these prompts through a new admin interface in the application.

## Components

### Backend (Lambda)

1. **prompt-manager.js**: A Lambda function that:
   - Retrieves prompt templates from S3
   - Updates prompt templates in S3
   - Validates admin access (only specific email addresses)
   - Provides default templates if none exist

2. **Modified Lambda Functions**:
   - `categorize-user-data.js`: Now uses templates from S3 instead of hardcoded prompts
   - `persona-builder.js`: Now uses templates from S3 instead of hardcoded prompts

### Frontend

1. **PromptManager.tsx**: A React component that:
   - Checks if the current user is an admin
   - Fetches prompt templates from the Lambda function
   - Allows viewing and editing prompt templates
   - Shows available template variables

2. **Navigation.tsx**: Updated to show the Prompt Manager link for admin users

3. **S3Service.ts**: Added a generic API call method for interacting with Lambda functions

## Template Variables

Each prompt type has its own set of template variables:

### categorize-user-data
- `{{fileName}}` - Name of the file being processed
- `{{userContext}}` - User's existing profile data
- `{{content}}` - Content of the file being analyzed

### persona-builder
- `{{personaType}}` - Type of persona (financial, social, etc.)
- `{{existingPersona}}` - Current persona data
- `{{fileName}}` - Name of the file being processed
- `{{fileType}}` - Type of file (e.g., facebook, google)
- `{{fileSummary}}` - Summary of the file content
- `{{relevance}}` - Relevance score for this persona type
- `{{categorySummary}}` - Summary for this category
- `{{dataPoints}}` - Key data points for this category
- `{{userProfile}}` - User master profile information
- `{{completeness}}` - Current completeness score
- `{{timestamp}}` - Current timestamp

## Admin Access

Admin access is restricted to specific email addresses:
- patavardhan@gmail.com
- sharadnyc@gmail.com

## Deployment

To deploy these changes:

1. Deploy the new prompt-manager Lambda function:
   ```
   cd lambda
   ./scripts/deploy-lambda-function.sh prompt-manager
   ```

2. Update the existing Lambda functions:
   ```
   ./scripts/deploy-lambda-function.sh categorize-user-data
   ./scripts/deploy-lambda-function.sh persona-builder
   ```

3. Configure API Gateway for the prompt-manager Lambda

## Future Improvements

- Move admin emails to environment variables or a database
- Add version history for prompts
- Create a testing environment for prompts
- Add more detailed analytics on prompt performance