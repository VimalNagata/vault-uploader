import React, { useState, useEffect } from 'react';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { ErrorBoundary } from 'react-error-boundary';
import Login from './components/Login';
import Navigation from './components/Navigation';
import Dashboard from './components/Dashboard';
import UploaderTabs from './components/UploaderTabs';
import ViewData from './components/ViewData';
import HomePage from './components/HomePage';
import RawData from './components/RawData';
import CategoryDetail from './components/CategoryDetail';
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
  const [currentPage, setCurrentPage] = useState<string>('home');

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
    setCurrentPage('dashboard'); // Always go to dashboard upon login
    
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
    
    // Redirect to home page
    setCurrentPage('home');
  };

  const handleNavigate = (page: string) => {
    // Redirect to login page for authenticated features
    if ((page === 'upload' || page === 'view' || page === 'personas' || page === 'dashboard' || 
        page === 'rawdata' || page.startsWith('category/')) && !isLoggedIn) {
      setCurrentPage('login');
    } else {
      setCurrentPage(page);
    }
  };

  const renderContent = () => {
    // Check if the page is a category detail page
    if (currentPage.startsWith('category/')) {
      const categoryName = currentPage.replace('category/', '');
      return <CategoryDetail 
        username={username} 
        category={categoryName} 
        onBack={() => handleNavigate('dashboard')} 
      />;
    }
    
    switch (currentPage) {
      case 'home':
        return <HomePage onNavigate={handleNavigate} />;
      case 'dashboard':
        return <Dashboard username={username} onNavigate={handleNavigate} />;
      case 'upload':
        return <UploaderTabs username={username} onUploadComplete={() => {}} />;
      case 'view':
        return <ViewData username={username} />;
      case 'rawdata':
        return <RawData username={username} />;
      case 'personas':
        // We'll implement this later
        return <div className="coming-soon-container">
          <h2>Personas Coming Soon</h2>
          <p>We're building AI models to analyze your data and create valuable personas.</p>
          <button onClick={() => handleNavigate('dashboard')}>Back to Dashboard</button>
        </div>;
      case 'guides':
        // We'll implement this later
        return <div className="coming-soon-container">
          <h2>Download Guides Coming Soon</h2>
          <p>We're creating step-by-step guides to help you download your data from major platforms.</p>
          <button onClick={() => handleNavigate('dashboard')}>Back to Dashboard</button>
        </div>;
      default:
        return <HomePage onNavigate={handleNavigate} />;
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
          <Navigation 
            username={username} 
            userInfo={userInfo}
            currentPage={currentPage} 
            onNavigate={handleNavigate}
            onLogout={handleLogout}
            isAuthenticated={isLoggedIn}
          />
          <main className="app-main">
            {currentPage === 'login' ? (
              <Login onLogin={handleLogin} />
            ) : (
              renderContent()
            )}
          </main>
        </div>
      </GoogleOAuthProvider>
    </ErrorBoundary>
  );
};

export default App;