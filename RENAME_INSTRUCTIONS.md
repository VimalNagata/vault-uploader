# Repository Name Synchronization Instructions

Currently, there's a mismatch between your:
- Local project folder name: `ccpauploader`
- GitHub repository name: `vault-uploader`

## Option 1: Rename Local Folder (Recommended)

This is the easiest solution if you want to keep the GitHub repository name as is.

1. Close all applications, terminals, and editors that are accessing this project folder
2. Run the provided script:
   ```
   ./rename-project.sh
   ```
3. Follow the prompts to confirm the renaming operation
4. After completion, navigate to the new directory:
   ```
   cd /Users/vimalnagata/Projects/vault-uploader
   ```

## Option 2: Rename GitHub Repository

If you prefer to keep your local folder name and change the GitHub repository name:

1. Go to your GitHub repository: https://github.com/VimalNagata/vault-uploader
2. Click on "Settings" in the top navigation bar
3. Under the "General" section, find the "Repository name" field
4. Change it to "ccpauploader"
5. Click "Rename"
6. Update your local git remote URL:
   ```
   git remote set-url origin https://github.com/VimalNagata/ccpauploader.git
   ```

## Option 3: Keep Both Names As Is

You can also choose to keep the names different if you prefer. This won't affect functionality but might be confusing for collaborators or when following documentation.

## After Renaming

After completing either renaming process:
- Verify your git remote connections with: `git remote -v`
- Make a small test commit and push to ensure everything is working
- Update any CI/CD configurations or deployment scripts that might reference the old name