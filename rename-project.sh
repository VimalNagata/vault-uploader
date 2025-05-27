#!/bin/bash
# Script to rename the local project folder to match the GitHub repository name

# Current setup
CURRENT_DIR="ccpauploader"
NEW_DIR="vault-uploader"
PARENT_DIR="/Users/vimalnagata/Projects"

echo "This script will rename your local project folder from $CURRENT_DIR to $NEW_DIR"
echo "to match your GitHub repository name."
echo ""
echo "Make sure to close all editors and terminals that are using the current folder."
echo ""
read -p "Are you sure you want to proceed? (y/n): " CONFIRM

if [[ "$CONFIRM" != "y" ]]; then
  echo "Operation cancelled."
  exit 0
fi

# Navigate to parent directory
cd "$PARENT_DIR" || { echo "Failed to navigate to parent directory"; exit 1; }

# Check if destination directory already exists
if [ -d "$NEW_DIR" ]; then
  echo "Error: Directory $NEW_DIR already exists. Please rename or remove it first."
  exit 1
fi

# Rename the directory
echo "Renaming $CURRENT_DIR to $NEW_DIR..."
mv "$CURRENT_DIR" "$NEW_DIR" || { echo "Failed to rename directory"; exit 1; }

echo "Success! Project directory renamed."
echo ""
echo "Your project is now located at: $PARENT_DIR/$NEW_DIR"
echo ""
echo "To continue working with this project, navigate to the new location:"
echo "cd $PARENT_DIR/$NEW_DIR"