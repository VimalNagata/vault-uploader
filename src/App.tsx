import React, { useState, useEffect } from 'react';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { ErrorBoundary } from 'react-error-boundary';
import Login from './components/Login';
import Navigation from './components/Navigation';
import Dashboard from './components/Dashboard';
import UploaderTabs from './components/UploaderTabs';
import ViewData from './components/ViewData';
import './App.css';

// Conditionally import S3Service or MockS3Service based on environment
// eslint-disable-next-line import/first
const S3Service = process.env.NODE_ENV === 'production' 
  ? require('./services/MockS3Service').default
  : require('./services/S3Service').default;

// Create a constant for the Google Client ID
const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID || '';

const App: React.FC = () => {
  // Authentication state
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [username, setUsername] = useState<string>('');
  
  // Navigation state
  const [currentPage, setCurrentPage] = useState<string>('dashboard');

  // Check if user was previously logged in
  useEffect(() => {
    const savedUsername = localStorage.getItem('dna_username');
    
    if (savedUsername) {
      setUsername(savedUsername);
      setIsLoggedIn(true);
    }
  }, []);

  const handleLogin = (username: string) => {
    setUsername(username);
    setIsLoggedIn(true);
    setCurrentPage('dashboard');
    
    // Save username to localStorage for persistence
    localStorage.setItem('dna_username', username);
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    setUsername('');
    
    // Clear from localStorage
    localStorage.removeItem('dna_username');
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
      <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID || "MISSING_CLIENT_ID"}>
        <div className="app">
          {process.env.NODE_ENV === 'production' && (
            <div className="demo-warning">
              <strong>Demo Mode:</strong> Running on GitHub Pages with no AWS connectivity. Upload functionality is disabled.
            </div>
          )}
          {isLoggedIn ? (
            <>
              <Navigation 
                username={username} 
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