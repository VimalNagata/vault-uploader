#!/bin/bash

# Build the React application
echo "Building React application..."
npm run build

# Verify the build output
echo "Checking build output..."
ls -la build/
ls -la build/static
ls -la build/static/js
ls -la build/static/css

# Upload to S3 with metadata and caching settings
echo "Uploading to S3..."
aws s3 sync build/ s3://dee-en-eh-react-app \
  --delete \
  --cache-control "max-age=31536000,public,must-revalidate" \
  --exclude "*.html" \
  --exclude "asset-manifest.json" \
  --exclude "manifest.json"

# Handle special files separately with no-cache for HTML and JSON configuration files
echo "Uploading HTML and configuration files with no-cache..."
aws s3 sync build/ s3://dee-en-eh-react-app \
  --exclude "*" \
  --include "*.html" \
  --include "asset-manifest.json" \
  --include "manifest.json" \
  --cache-control "no-cache,no-store,must-revalidate" \
  --content-type "text/html; charset=utf-8"

# Set CORS configuration
echo "Setting CORS configuration..."
aws s3api put-bucket-cors --bucket dee-en-eh-react-app --cors-configuration file://cors-config.json

# Make sure the bucket has website configuration
echo "Setting up website configuration..."
aws s3 website s3://dee-en-eh-react-app --index-document index.html --error-document index.html

# Check if website configuration is applied
echo "Checking bucket website configuration..."
aws s3api get-bucket-website --bucket dee-en-eh-react-app || echo "Website configuration missing!"

# Verify the index.html file exists and has proper content type
echo "Verifying index.html..."
aws s3api head-object --bucket dee-en-eh-react-app --key index.html

echo "Deployment complete."
echo "Website URL: http://dee-en-eh-react-app.s3-website-us-east-1.amazonaws.com"