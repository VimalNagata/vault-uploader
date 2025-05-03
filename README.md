# Dee-en-eh Data Vault

A secure application for storing and managing personal data with multiple upload methods.

## Features

- User authentication with secure login
- Two data upload methods:
  - Manual file/folder upload with drag and drop functionality
  - Email data import from Google Mail
- Secure storage to AWS S3 with custom vault structure
- File organization in personal vault structure (`<username>/vault/rawdata/`)
- File viewing and management interface with search and filtering
- Dashboard with quick access to key functions

## Setup and Installation

### Prerequisites

- Node.js (v14 or higher)
- NPM or Yarn
- AWS Account with S3 access
- Google Cloud Console project (for email upload feature)

### Installation

1. Clone the repository
```bash
git clone https://github.com/yourusername/deeeneh-data-vault.git
cd deeeneh-data-vault
```

2. Install dependencies
```bash
npm install
```

3. Configure environment variables
Create a `.env` file in the root directory with the following variables:
```
REACT_APP_AWS_REGION=your-region
REACT_APP_AWS_ACCESS_KEY_ID=your-access-key
REACT_APP_AWS_SECRET_ACCESS_KEY=your-secret-key
REACT_APP_S3_BUCKET_NAME=your-bucket-name
REACT_APP_GOOGLE_CLIENT_ID=your-google-client-id
```

### Setting up Google OAuth

1. Go to the [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create a new project or select an existing one
3. Navigate to "APIs & Services" > "Credentials"
4. Click "Create Credentials" > "OAuth client ID"
5. Set up the OAuth consent screen if prompted
6. For Application Type, select "Web application"
7. Add "http://localhost:3000" as an authorized JavaScript origin
8. Copy the Client ID and add it to your .env file as REACT_APP_GOOGLE_CLIENT_ID

## Usage

Start the development server:

```bash
npm start
```

Then open [http://localhost:3000](http://localhost:3000) to view the app in your browser.

### Login

- Default login username: Any username
- Default password: w1234ard

### Manual Upload

1. Navigate to the "Upload Data" page
2. Select the "Manual Upload" tab
3. Drag and drop files or folders to the upload area
4. Click "Upload to Vault"

### Email Upload

1. Navigate to the "Upload Data" page
2. Select the "Email Upload" tab
3. Click "Connect to Google Email"
4. Authorize the application
5. Review the retrieved emails
6. Click "Upload Emails to Vault"

### Viewing Data

1. Navigate to the "View My Data" page
2. Browse your uploaded files
3. Filter files by category or search term
4. View file details and download options

## Building and Deployment

### Building for Production

```bash
npm run build
```

This creates a `build` folder with the optimized production build.

### Deploying to GitHub Pages

The application is configured for easy deployment to GitHub Pages.

1. Make sure the `homepage` field in `package.json` matches your GitHub Pages URL
2. Run the deploy command:

```bash
npm run deploy
```

3. Your application will be built and deployed to the `gh-pages` branch
4. GitHub Pages will serve your application from the specified homepage URL

## Security Considerations

- Never commit your AWS credentials to version control
- Consider using AWS Cognito or another authentication service for production use
- Set up appropriate CORS and bucket policies on your S3 bucket
- For production applications, consider using presigned URLs instead of direct API access

## License

MIT