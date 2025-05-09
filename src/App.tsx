import React, { useState, useEffect } from 'react';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { ErrorBoundary } from 'react-error-boundary';
import Login from './components/Login';
import Navigation from './components/Navigation';
import Dashboard from './components/Dashboard';
import UploaderTabs from './components/UploaderTabs';
import ViewData from './components/ViewData';
import './App.css';

// Import the real S3Service
// eslint-disable-next-line import/first
import S3Service from './services/S3Service';

// Log the environment
console.log('Environment:', {
  NODE_ENV: process.env.NODE_ENV
});

// Get Google OAuth Client ID from environment variable
const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID || '';

// Check if the client ID is available and warn if missing
if (!GOOGLE_CLIENT_ID) {
  console.warn(
    'Google OAuth Client ID is not configured. Please set REACT_APP_GOOGLE_CLIENT_ID in your .env file. ' +
    'You can get one from https://console.cloud.google.com/apis/credentials'
  );
}

// User information interface
interface UserInfo {
  email: string;
  name?: string;
  picture?: string;
  given_name?: string;
  family_name?: string;
  provider: string;
}

const App: React.FC = () => {
  // Authentication state
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [username, setUsername] = useState<string>('');
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  
  // Navigation state
  const [currentPage, setCurrentPage] = useState<string>('dashboard');

  // Check if user was previously logged in
  useEffect(() => {
    const savedUsername = localStorage.getItem('dna_username');
    const savedUserInfo = localStorage.getItem('dna_user_info');
    
    if (savedUsername) {
      setUsername(savedUsername);
      setIsLoggedIn(true);
      
      // Restore user info if available
      if (savedUserInfo) {
        try {
          const parsedUserInfo = JSON.parse(savedUserInfo);
          setUserInfo(parsedUserInfo);
        } catch (err) {
          console.error('Failed to parse user info from localStorage', err);
        }
      }
    }
  }, []);

  const handleLogin = (username: string) => {
    setUsername(username);
    setIsLoggedIn(true);
    setCurrentPage('dashboard');
    
    // Save username to localStorage for persistence
    localStorage.setItem('dna_username', username);
    
    // Get user info from localStorage (set by Login component)
    const savedUserInfo = localStorage.getItem('dna_user_info');
    if (savedUserInfo) {
      try {
        const parsedUserInfo = JSON.parse(savedUserInfo);
        setUserInfo(parsedUserInfo);
      } catch (err) {
        console.error('Failed to parse user info from localStorage', err);
      }
    }
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    setUsername('');
    setUserInfo(null);
    
    // Clear from localStorage
    localStorage.removeItem('dna_username');
    localStorage.removeItem('dna_user_info');
  };

  const handleNavigate = (page: string) => {
    setCurrentPage(page);
  };

  const renderContent = () => {
    switch (currentPage) {
      case 'dashboard':
        return <Dashboard username={username} onNavigate={handleNavigate} />;
      case 'upload':
        return <UploaderTabs username={username} onUploadComplete={() => {}} />;
      case 'view':
        return <ViewData username={username} />;
      default:
        return <Dashboard username={username} onNavigate={handleNavigate} />;
    }
  };

  // Error fallback component
  const ErrorFallback = ({ error, resetErrorBoundary }: { error: Error, resetErrorBoundary: () => void }) => (
    <div className="error-boundary">
      <h2>Something went wrong</h2>
      <pre>{error.message}</pre>
      <button onClick={resetErrorBoundary}>Try again</button>
    </div>
  );

  return (
    <ErrorBoundary
      FallbackComponent={ErrorFallback}
      onReset={() => {
        // Reset the state here
        console.log("Error boundary reset");
      }}
    >
      <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
        <div className="app">
          {isLoggedIn ? (
            <>
              <Navigation 
                username={username} 
                userInfo={userInfo}
                currentPage={currentPage} 
                onNavigate={handleNavigate}
                onLogout={handleLogout}
              />
              <main className="app-main">
                {renderContent()}
              </main>
            </>
          ) : (
            <Login onLogin={handleLogin} />
          )}
        </div>
      </GoogleOAuthProvider>
    </ErrorBoundary>
  );
};

export default App;