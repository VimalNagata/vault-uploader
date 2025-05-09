#!/bin/bash
# Script to update the Google JWT authorizer Lambda function

echo "Creating a temporary directory for the authorizer..."
mkdir -p temp_authorizer

# Copy the fixed authorizer code
cp google-jwt-authorizer.js temp_authorizer/

# Create a package.json for the authorizer
cat > temp_authorizer/package.json <<EOL
{
  "name": "google-jwt-authorizer",
  "version": "1.0.0",
  "main": "google-jwt-authorizer.js",
  "dependencies": {
    "google-auth-library": "^8.9.0"
  }
}
EOL

# Install dependencies
echo "Installing dependencies..."
(cd temp_authorizer && npm install --production)

# Create the ZIP file
echo "Creating zip package..."
mkdir -p dist
(cd temp_authorizer && zip -r ../dist/google-jwt-authorizer.zip .)

# Show the content of the zip file
echo "Contents of google-jwt-authorizer.zip:"
unzip -l dist/google-jwt-authorizer.zip | head -n 10

# Clean up
rm -rf temp_authorizer

# Update the Lambda function
echo "Updating Lambda function..."
aws lambda update-function-code \
  --function-name google-jwt-authorizer \
  --zip-file fileb://dist/google-jwt-authorizer.zip

echo "Update completed. Check the Lambda function logs to verify it's working correctly."