#!/bin/bash
# Script to update the AWS credentials Lambda function

echo "Creating a temporary directory for the credentials function..."
mkdir -p temp_credentials

# Copy the function code
cp get-aws-credentials.js temp_credentials/

# Create a package.json for the function
cat > temp_credentials/package.json <<EOL
{
  "name": "get-aws-credentials",
  "version": "1.0.0",
  "main": "get-aws-credentials.js",
  "dependencies": {
    "aws-sdk": "^2.1469.0"
  }
}
EOL

# Install dependencies
echo "Installing dependencies..."
(cd temp_credentials && npm install --production)

# Create the ZIP file
echo "Creating zip package..."
mkdir -p dist
(cd temp_credentials && zip -r ../dist/get-aws-credentials.zip .)

# Show the content of the zip file
echo "Contents of get-aws-credentials.zip:"
unzip -l dist/get-aws-credentials.zip | head -n 10

# Clean up
rm -rf temp_credentials

# Update the Lambda function
echo "Updating Lambda function..."
aws lambda update-function-code \
  --function-name get-aws-credentials \
  --zip-file fileb://dist/get-aws-credentials.zip

echo "Update completed. Check the Lambda function logs to verify it's working correctly."