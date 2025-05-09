# IAM Setup Instructions for AWS Credentials Lambda

## Overview
This document provides detailed instructions for setting up the required IAM roles and policies for the AWS credentials generation Lambda function. 

## Required IAM Roles and Policies

### 1. Lambda Execution Role
This role is attached to the Lambda function and allows it to execute and assume other roles.

**Create Role:**
```bash
aws iam create-role \
  --role-name LambdaCredentialsExecutionRole \
  --assume-role-policy-document '{
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
  }'
```

**Attach Policies:**
```bash
# Allow Lambda to write logs
aws iam attach-role-policy \
  --role-name LambdaCredentialsExecutionRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

# Allow Lambda to assume the S3AccessRole
aws iam put-role-policy \
  --role-name LambdaCredentialsExecutionRole \
  --policy-name AssumeS3AccessRole \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": "sts:AssumeRole",
        "Resource": "arn:aws:iam::[ACCOUNT_ID]:role/S3AccessRole"
      }
    ]
  }'
```

### 2. S3 Access Role 
This role is assumed by the Lambda function and has permissions to access the S3 bucket with an inline policy applied.

**Create Role:**
```bash
aws iam create-role \
  --role-name S3AccessRole \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Principal": {
          "AWS": "arn:aws:iam::[ACCOUNT_ID]:role/LambdaCredentialsExecutionRole"
        },
        "Action": "sts:AssumeRole"
      }
    ]
  }'
```

**IMPORTANT: You need to attach a policy to this role that uses the session name for access control.** 

Here's an example policy to attach to the S3AccessRole:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject"
      ],
      "Resource": [
        "arn:aws:s3:::YOUR_BUCKET_NAME/${aws:userid}/*",
        "arn:aws:s3:::YOUR_BUCKET_NAME/${aws:userid}"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket"
      ],
      "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME",
      "Condition": {
        "StringLike": {
          "s3:prefix": [
            "${aws:userid}/*",
            "${aws:userid}"
          ]
        }
      }
    }
  ]
}
```

In this policy:
- `${aws:userid}` will be automatically substituted with the role session name
- The Lambda function sets the role session name to the sanitized email address
- This ensures each user can only access their own files

## Lambda Environment Variables

Set these environment variables on your Lambda function:

- `S3_BUCKET_NAME`: The name of your S3 bucket
- `AWS_REGION`: The AWS region to use
- `S3_ROLE_ARN`: The ARN of the S3AccessRole created above

Example:
```
S3_BUCKET_NAME=dee-en-eh-bucket
AWS_REGION=us-east-1
S3_ROLE_ARN=arn:aws:iam::[ACCOUNT_ID]:role/S3AccessRole
```

## Debugging IAM Issues

If you encounter permission errors:

1. Check CloudWatch logs for detailed error messages (we've added comprehensive logging)

2. **For AccessDenied errors:**
   - Check the Lambda execution role ARN (shown in the logs) 
   - Verify that this exact ARN is in the trust policy of the S3 access role
   - Ensure the Lambda execution role has an inline policy allowing `sts:AssumeRole` for the S3 role

3. **Understanding the logs:**
   - The Lambda will log its own identity with `Lambda execution identity`
   - After assume role, it logs the new identity with `Caller identity after assuming role`
   - You'll see detailed information about the policy being applied
   - If there's a mismatch between any of these values and your configuration, it will point to the source of the problem

4. **Common errors and fixes:**

   | Error | Probable Cause | Fix |
   |-------|----------------|-----|
   | `AccessDenied: User [Lambda ARN] is not authorized to perform: sts:AssumeRole on resource: [S3 Role ARN]` | Missing permission or trust relationship | Add sts:AssumeRole permission to Lambda role and update trust policy on S3 role |
   | `ValidationError: Value at 'policy' failed to satisfy constraint` | Policy too large or malformed | Simplify policy or check JSON syntax |
   | `Error generating credentials: Cannot read properties of undefined` | Environment variable issues | Check that S3_ROLE_ARN and S3_BUCKET_NAME are set correctly |

5. **Verify IAM setup with AWS CLI:**
   ```bash
   # Check if Lambda role can call AssumeRole
   aws iam simulate-principal-policy \
     --policy-source-arn arn:aws:iam::[ACCOUNT_ID]:role/LambdaCredentialsExecutionRole \
     --action-names sts:AssumeRole \
     --resource-arns arn:aws:iam::[ACCOUNT_ID]:role/S3AccessRole
   
   # Check S3 access role trust policy
   aws iam get-role --role-name S3AccessRole
   ```

## Policy Generation

The Lambda function generates a policy that:
- Allows the user to put/get objects only in their folder prefix
- Allows the user to list objects in the bucket, but only with their prefix
- These permissions are dynamically generated based on the user's email

This security model ensures each user can only access their own data.