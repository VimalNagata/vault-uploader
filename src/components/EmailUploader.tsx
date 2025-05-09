import React, { useState, useEffect } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import S3Service from '../services/S3Service';

interface EmailUploaderProps {
  username: string;
}

interface Email {
  id: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
}

const EmailUploader: React.FC<EmailUploaderProps> = ({ username }) => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [emails, setEmails] = useState<Email[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadComplete, setUploadComplete] = useState(false);
  const [clientIdMissing, setClientIdMissing] = useState(false);

  // Check if Google client ID is configured
  useEffect(() => {
    const clientId = process.env.REACT_APP_GOOGLE_CLIENT_ID;
    if (!clientId) {
      setClientIdMissing(true);
      setError('Google Client ID is not configured. Please add it to your .env file.');
    }
  }, []);

  // Google login configuration
  const login = useGoogleLogin({
    onSuccess: (tokenResponse) => handleLoginSuccess(tokenResponse),
    onError: (error) => setError('Login Failed: ' + error),
    scope: 'https://www.googleapis.com/auth/gmail.readonly',
    onNonOAuthError: (error) => {
      console.error("OAuth Error:", error);
      setError(`OAuth Error: ${error.type || 'Unknown'}`);
    }
  });

  const handleLoginSuccess = async (tokenResponse: any) => {
    try {
      setIsLoading(true);
      setError(null);
      
      // Use the token to fetch messages via Gmail REST API directly
      const accessToken = tokenResponse.access_token;
      
      // Fetch email list
      const listResponse = await fetch(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=100',
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );
      
      const listData = await listResponse.json();
      
      if (!listData.messages || listData.messages.length === 0) {
        setError('No emails found in your account.');
        setIsLoading(false);
        return;
      }
      
      // Fetch email details for each message
      const emailDetails: Email[] = [];
      let processed = 0;
      const totalEmails = Math.min(listData.messages.length, 100);
      
      for (const message of listData.messages.slice(0, 100)) {
        if (message.id) {
          try {
            // Fetch full message data
            const emailResponse = await fetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}`,
              {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                },
              }
            );
            
            const emailData = await emailResponse.json();
            
            if (emailData) {
              const headers = emailData.payload?.headers || [];
              const from = headers.find((h: any) => h.name === 'From')?.value || 'Unknown';
              const subject = headers.find((h: any) => h.name === 'Subject')?.value || 'No Subject';
              const date = headers.find((h: any) => h.name === 'Date')?.value || '';
              
              emailDetails.push({
                id: message.id,
                from,
                subject,
                date,
                snippet: emailData.snippet || '',
              });
            }
          } catch (err) {
            console.error('Error fetching email details:', err);
          }
          
          processed++;
          setProgress(Math.floor((processed / totalEmails) * 100));
        }
      }
      
      setEmails(emailDetails);
      setIsLoggedIn(true);
    } catch (err) {
      console.error('Error fetching emails:', err);
      setError('Failed to fetch emails: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsLoading(false);
    }
  };

  const handleUploadEmails = async () => {
    if (emails.length === 0) {
      setError('No emails to upload');
      return;
    }
    
    if (!username) {
      setError('Please enter a username first');
      return;
    }

    try {
      setIsUploading(true);
      setError(null);
      
      // Convert emails to JSON files for S3 upload
      const emailsJson = JSON.stringify(emails, null, 2);
      const emailBlob = new Blob([emailsJson], { type: 'application/json' });
      const emailFile = new File([emailBlob], `emails-${new Date().toISOString()}.json`, { type: 'application/json' });
      
      // Upload to S3
      await S3Service.uploadFile(
        emailFile,
        `${username}/vault/rawdata/emails`
      );
      
      // For individual email files if desired
      const individualUploads = emails.map((email, index) => {
        const emailContent = JSON.stringify(email, null, 2);
        const blob = new Blob([emailContent], { type: 'application/json' });
        const file = new File([blob], `email-${email.id}.json`, { type: 'application/json' });
        
        // Update progress
        setProgress(Math.floor((index / emails.length) * 100));
        
        return S3Service.uploadFile(
          file,
          `${username}/vault/rawdata/emails/individual`
        );
      });
      
      await Promise.all(individualUploads);
      
      setUploadComplete(true);
    } catch (err) {
      console.error('Upload error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(`Upload failed: ${errorMessage}`);
    } finally {
      setIsUploading(false);
    }
  };

  const logout = () => {
    setIsLoggedIn(false);
    setEmails([]);
    setProgress(0);
    setUploadComplete(false);
  };

  return (
    <div className="email-uploader">
      <h2>Email Upload to Vault</h2>
      
      {!isLoggedIn ? (
        <div className="login-section">
          <p>Connect to your email to upload your recent emails to the vault.</p>
          {clientIdMissing ? (
            <div className="setup-instructions">
              <h3>Setup Required</h3>
              <p>Before using the Email Upload feature, you need to configure a Google OAuth Client ID:</p>
              <ol>
                <li>Go to the <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer">Google Cloud Console</a></li>
                <li>Create a new project or select an existing one</li>
                <li>Navigate to "APIs &amp; Services" {'->'} "Credentials"</li>
                <li>Click "Create Credentials" {'->'} "OAuth client ID"</li>
                <li>Set up the OAuth consent screen if prompted</li>
                <li>For Application Type, select "Web application"</li>
                <li>Add "http://localhost:3000" as an authorized JavaScript origin for local development</li>
                <li>Add your production domain as an authorized JavaScript origin when deploying</li>
                <li>Copy the Client ID and add it to your .env file as REACT_APP_GOOGLE_CLIENT_ID</li>
                <li>Restart the application</li>
              </ol>
            </div>
          ) : (
            <button 
              onClick={() => login()} 
              disabled={isLoading}
              className="google-login-button"
            >
              {isLoading ? 'Connecting...' : 'Connect to Google Email'}
            </button>
          )}
        </div>
      ) : (
        <div className="emails-section">
          <div className="email-header">
            <h3>Fetched {emails.length} emails</h3>
            <button onClick={logout} className="logout-button">Disconnect</button>
          </div>
          
          {emails.length > 0 && (
            <div className="email-list">
              <p>Retrieved {emails.length} emails from your account.</p>
              <ul>
                {emails.slice(0, 5).map((email) => (
                  <li key={email.id}>
                    <strong>{email.subject}</strong> - {email.from}
                  </li>
                ))}
                {emails.length > 5 && <li>...and {emails.length - 5} more emails</li>}
              </ul>
              
              {isUploading ? (
                <div className="progress-container">
                  <div className="progress-bar" style={{ width: `${progress}%` }}></div>
                  <span>{progress}%</span>
                </div>
              ) : (
                <button 
                  onClick={handleUploadEmails} 
                  disabled={emails.length === 0 || !username}
                  className="upload-button"
                >
                  Upload Emails to S3
                </button>
              )}
            </div>
          )}
          
          {uploadComplete && (
            <div className="success-message">
              Upload complete! All emails were successfully uploaded to S3.
            </div>
          )}
        </div>
      )}
      
      {error && <div className="error-message">{error}</div>}
      
      {isLoading && (
        <div className="progress-container">
          <div className="progress-bar" style={{ width: `${progress}%` }}></div>
          <span>{progress}%</span>
        </div>
      )}
    </div>
  );
};

export default EmailUploader;