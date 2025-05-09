#!/bin/bash
# A more efficient script for building Lambda deployment packages

# Create dist directory if it doesn't exist
mkdir -p dist

# Function to create minimal Lambda package
create_lambda_package() {
  local function_name=$1
  local dependencies=$2
  
  echo "Creating package for $function_name..."
  
  # Create a temporary directory
  mkdir -p temp_$function_name
  
  # Copy the function file
  cp $function_name.js temp_$function_name/
  
  # Create a package.json
  cat > temp_$function_name/package.json <<EOL
{
  "name": "$function_name",
  "version": "1.0.0",
  "main": "$function_name.js",
  "dependencies": {
    $dependencies
  }
}
EOL
  
  echo "Installing dependencies for $function_name..."
  
  # Install only the required dependencies
  (cd temp_$function_name && npm install --production)
  
  echo "Creating zip file for $function_name..."
  
  # Create the ZIP file
  (cd temp_$function_name && zip -r ../dist/$function_name.zip .)
  
  # Show the content of the zip file
  echo "Contents of $function_name.zip:"
  unzip -l dist/$function_name.zip | head -n 10
  
  # Clean up the temporary directory
  rm -rf temp_$function_name
  
  echo "Package created at dist/$function_name.zip"
}

# For Node.js 18 or newer runtimes, explicitly include aws-sdk since it's no longer bundled
echo "Building get-aws-credentials Lambda..."
create_lambda_package "get-aws-credentials" '"aws-sdk": "^2.1469.0"'

echo "Building google-jwt-authorizer Lambda..."
create_lambda_package "google-jwt-authorizer" '"google-auth-library": "^8.9.0"'

echo "All Lambda packages created successfully!"