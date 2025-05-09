#!/bin/bash

# Configure variables
S3_BUCKET="dee-en-eh-react-app"
CLOUDFRONT_DISTRIBUTION_ID="E3QB86OHQX5C36"
REGION="us-east-1"

# Set color variables
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Display a colorful header
echo -e "${BLUE}=========================================================${NC}"
echo -e "${GREEN} Dee-en-eh React App Deployment Script ${NC}"
echo -e "${BLUE}=========================================================${NC}"

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo -e "${RED}Error: AWS CLI is not installed.${NC}"
    echo -e "Please install AWS CLI first: https://aws.amazon.com/cli/"
    exit 1
fi

# Check if AWS credentials are configured
if ! aws sts get-caller-identity &> /dev/null; then
    echo -e "${RED}Error: AWS credentials not configured or insufficient permissions.${NC}"
    echo -e "Please run 'aws configure' to set up your credentials."
    exit 1
fi

# Build the React application
echo -e "\n${YELLOW}Step 1: Building React application...${NC}"
npm run build
if [ $? -ne 0 ]; then
    echo -e "${RED}Error: Build failed. Please fix the errors and try again.${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Build successful!${NC}"

# Validate the build files
echo -e "\n${YELLOW}Step 2: Validating build output...${NC}"
if [ ! -d "build" ]; then
    echo -e "${RED}Error: Build directory not found.${NC}"
    exit 1
fi

if [ ! -f "build/index.html" ]; then
    echo -e "${RED}Error: index.html not found in build directory.${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Build output validated!${NC}"

# Upload static assets with caching
echo -e "\n${YELLOW}Step 3: Uploading static assets to S3 with caching...${NC}"
aws s3 sync build/static s3://$S3_BUCKET/static \
  --delete \
  --cache-control "max-age=31536000,public,must-revalidate" \
  --region $REGION

if [ $? -ne 0 ]; then
    echo -e "${RED}Error: Failed to upload static assets.${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Static assets uploaded successfully!${NC}"

# Upload HTML and config files with no-cache
echo -e "\n${YELLOW}Step 4: Uploading HTML and configuration files...${NC}"
aws s3 sync build/ s3://$S3_BUCKET/ \
  --delete \
  --exclude "static/*" \
  --cache-control "no-cache,no-store,must-revalidate" \
  --region $REGION

if [ $? -ne 0 ]; then
    echo -e "${RED}Error: Failed to upload HTML and configuration files.${NC}"
    exit 1
fi
echo -e "${GREEN}✓ HTML and configuration files uploaded successfully!${NC}"

# Set proper content types for specific file types
echo -e "\n${YELLOW}Step 5: Setting correct content types...${NC}"
for html_file in $(find build -name "*.html" -type f -not -path "*/static/*"); do
    relative_path=${html_file#build/}
    echo "Setting content-type for $relative_path"
    aws s3 cp s3://$S3_BUCKET/$relative_path s3://$S3_BUCKET/$relative_path \
      --content-type "text/html; charset=utf-8" \
      --metadata-directive REPLACE \
      --cache-control "no-cache,no-store,must-revalidate" \
      --region $REGION
done

for json_file in $(find build -name "*.json" -type f -not -path "*/static/*"); do
    relative_path=${json_file#build/}
    echo "Setting content-type for $relative_path"
    aws s3 cp s3://$S3_BUCKET/$relative_path s3://$S3_BUCKET/$relative_path \
      --content-type "application/json; charset=utf-8" \
      --metadata-directive REPLACE \
      --cache-control "no-cache,no-store,must-revalidate" \
      --region $REGION
done
echo -e "${GREEN}✓ Content types set correctly!${NC}"

# Create CloudFront invalidation
echo -e "\n${YELLOW}Step 6: Creating CloudFront invalidation...${NC}"
INVALIDATION_ID=$(aws cloudfront create-invalidation \
  --distribution-id $CLOUDFRONT_DISTRIBUTION_ID \
  --paths "/*" \
  --query 'Invalidation.Id' \
  --output text \
  --region $REGION)

if [ $? -ne 0 ]; then
    echo -e "${RED}Error: Failed to create CloudFront invalidation.${NC}"
    exit 1
fi
echo -e "${GREEN}✓ CloudFront invalidation created successfully!${NC}"
echo -e "${BLUE}Invalidation ID: ${INVALIDATION_ID}${NC}"

# Check invalidation status
echo -e "\n${YELLOW}Step 7: Checking invalidation status...${NC}"
echo -e "${BLUE}Waiting for invalidation to complete (this may take a few minutes)...${NC}"

while true; do
    STATUS=$(aws cloudfront get-invalidation \
      --distribution-id $CLOUDFRONT_DISTRIBUTION_ID \
      --id $INVALIDATION_ID \
      --query 'Invalidation.Status' \
      --output text \
      --region $REGION)
    
    if [ "$STATUS" == "Completed" ]; then
        echo -e "${GREEN}✓ Invalidation completed successfully!${NC}"
        break
    fi
    
    echo -e "${YELLOW}Invalidation status: ${STATUS}. Checking again in 10 seconds...${NC}"
    sleep 10
done

# Display completion message
echo -e "\n${BLUE}=========================================================${NC}"
echo -e "${GREEN} Deployment completed successfully! ${NC}"
echo -e "${BLUE}=========================================================${NC}"
echo -e "Website is now available at:"
echo -e "${YELLOW}S3 Website:${NC} http://$S3_BUCKET.s3-website-$REGION.amazonaws.com"
echo -e "${YELLOW}CloudFront:${NC} https://digitaldna.red"
echo -e "${BLUE}=========================================================${NC}"