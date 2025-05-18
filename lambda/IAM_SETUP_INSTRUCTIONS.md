# IAM Role Setup Instructions

This document guides you through setting up the necessary IAM roles for the Digital DNA Lambda functions.

## Prerequisites

- AWS account with admin access
- AWS CLI installed and configured

## IAM Roles Overview

For the Digital DNA application, you need to create three IAM roles:

1. **lambda-get-aws-credentials-role**: For the get-aws-credentials Lambda function
2. **lambda-google-jwt-authorizer-role**: For the google-jwt-authorizer Lambda function
3. **lambda-get-user-data-metrics-role**: For the get-user-data-metrics Lambda function

## Step 1: Create Trust Relationship Policy

All Lambda roles need the same trust relationship. Create a file named `trust-policy.json`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

## Step 2: Create AWS Credentials Lambda Role

### Create the base role with the trust policy:

```bash
aws iam create-role \
  --role-name lambda-get-aws-credentials-role \
  --assume-role-policy-document file://trust-policy.json
```

### Attach the basic Lambda execution policy:

```bash
aws iam attach-role-policy \
  --role-name lambda-get-aws-credentials-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
```

### Create policy for federation token access:

Create a file named `credentials-policy.json`:

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

### Attach the custom policy:

```bash
aws iam put-role-policy \
  --role-name lambda-get-aws-credentials-role \
  --policy-name federation-token-access \
  --policy-document file://credentials-policy.json
```

## Step 3: Create Google JWT Authorizer Lambda Role

### Create the base role with the trust policy:

```bash
aws iam create-role \
  --role-name lambda-google-jwt-authorizer-role \
  --assume-role-policy-document file://trust-policy.json
```

### Attach the basic Lambda execution policy:

```bash
aws iam attach-role-policy \
  --role-name lambda-google-jwt-authorizer-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
```

## Step 4: Create User Data Metrics Lambda Role

### Create the base role with the trust policy:

```bash
aws iam create-role \
  --role-name lambda-get-user-data-metrics-role \
  --assume-role-policy-document file://trust-policy.json
```

### Attach the basic Lambda execution policy:

```bash
aws iam attach-role-policy \
  --role-name lambda-get-user-data-metrics-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
```

### Create policy for S3 access:

Before creating this policy, replace `YOUR-BUCKET-NAME` with your actual S3 bucket name in the file below.

Create a file named `s3-metrics-policy.json`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::YOUR-BUCKET-NAME"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject"
      ],
      "Resource": [
        "arn:aws:s3:::YOUR-BUCKET-NAME/*"
      ]
    }
  ]
}
```

### Attach the custom policy:

```bash
aws iam put-role-policy \
  --role-name lambda-get-user-data-metrics-role \
  --policy-name s3-metrics-access \
  --policy-document file://s3-metrics-policy.json
```

## Verification

Verify that the roles have been created and have the correct policies attached:

```bash
# List all roles
aws iam list-roles --query 'Roles[?starts_with(RoleName, `lambda-`)].[RoleName]' --output text

# Check policies for a specific role
aws iam list-attached-role-policies --role-name lambda-get-aws-credentials-role
aws iam list-role-policies --role-name lambda-get-aws-credentials-role
```

## Using Role ARNs for Lambda Deployment

When creating Lambda functions, you'll need the ARN for each role. Get the ARNs with:

```bash
aws iam get-role --role-name lambda-get-aws-credentials-role --query 'Role.Arn' --output text
aws iam get-role --role-name lambda-google-jwt-authorizer-role --query 'Role.Arn' --output text
aws iam get-role --role-name lambda-get-user-data-metrics-role --query 'Role.Arn' --output text
```

Use these ARNs when deploying the Lambda functions.

## Clean Up

If you need to remove these roles, first detach all policies:

```bash
aws iam detach-role-policy \
  --role-name lambda-get-aws-credentials-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

aws iam delete-role-policy \
  --role-name lambda-get-aws-credentials-role \
  --policy-name federation-token-access

# Repeat for other roles...

# Then delete the roles
aws iam delete-role --role-name lambda-get-aws-credentials-role
aws iam delete-role --role-name lambda-google-jwt-authorizer-role
aws iam delete-role --role-name lambda-get-user-data-metrics-role
```

## Troubleshooting

If you encounter permissions issues with your Lambda functions:

1. Check CloudWatch Logs for specific error messages
2. Verify the trust relationship is correctly configured
3. Ensure that the attached policies have the necessary permissions
4. Confirm that the role ARNs in your Lambda configurations are correct

For more assistance, refer to the [AWS IAM documentation](https://docs.aws.amazon.com/IAM/latest/UserGuide/introduction.html).