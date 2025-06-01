import React, { useState, useEffect } from 'react';
import './Navigation.css';

interface UserInfo {
  email: string;
  name?: string;
  picture?: string;
  given_name?: string;
  family_name?: string;
  provider: string;
}

interface NavigationProps {
  username: string;
  userInfo: UserInfo | null;
  currentPage: string;
  onNavigate: (page: string) => void;
  onLogout: () => void;
  isAuthenticated: boolean;
}

// List of admin email addresses
const ADMIN_EMAILS = ["patavardhan@gmail.com", "sharadnyc@gmail.com"];

const Navigation: React.FC<NavigationProps> = ({ 
  username, 
  userInfo,
  currentPage, 
  onNavigate, 
  onLogout,
  isAuthenticated
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const displayName = userInfo?.name || userInfo?.given_name || username;
  
  // Check if current user is an admin
  useEffect(() => {
    if (userInfo && userInfo.email) {
      setIsAdmin(ADMIN_EMAILS.includes(userInfo.email));
    } else {
      setIsAdmin(false);
    }
  }, [userInfo]);
  
  // Toggle mobile menu
  const toggleMobileMenu = () => {
    setMobileMenuOpen(!mobileMenuOpen);
  };
  
  // Navigation options
  const navigateAndClose = (page: string) => {
    onNavigate(page);
    setMobileMenuOpen(false);
  };
  
  return (
    <nav className="main-nav">
      <div className="nav-logo" onClick={() => navigateAndClose(isAuthenticated ? 'dashboard' : 'home')}>
        <h1>Digital DNA</h1>
      </div>
      
      <div className="mobile-menu-button" onClick={toggleMobileMenu}>
        <span></span>
        <span></span>
        <span></span>
      </div>
      
      {isAuthenticated ? (
        <ul className={`nav-links ${mobileMenuOpen ? 'mobile-open' : ''}`}>
          <li className={currentPage === 'dashboard' ? 'active' : ''}>
            <button onClick={() => navigateAndClose('dashboard')}>Dashboard</button>
          </li>
          {isAdmin && (
            <li className={currentPage === 'prompts' ? 'active' : ''}>
              <button onClick={() => navigateAndClose('prompts')}>Prompt Manager</button>
            </li>
          )}
        </ul>
      ) : (
        <ul className={`nav-links ${mobileMenuOpen ? 'mobile-open' : ''}`}>
          <li className={currentPage === 'home' ? 'active' : ''}>
            <button onClick={() => navigateAndClose('home')}>Home</button>
          </li>
          <li className={currentPage === 'guides' ? 'active' : ''}>
            <button onClick={() => navigateAndClose('guides')}>Data Guides</button>
          </li>
          <li className={currentPage === 'pricing' ? 'active' : ''}>
            <button onClick={() => navigateAndClose('pricing')}>Pricing</button>
          </li>
          <li className={currentPage === 'about' ? 'active' : ''}>
            <button onClick={() => navigateAndClose('about')}>About Us</button>
          </li>
        </ul>
      )}
      
      <div className="nav-user">
        {isAuthenticated && userInfo?.picture && (
          <img 
            src={userInfo.picture} 
            alt="Profile" 
            className="user-avatar" 
          />
        )}
        {isAuthenticated ? (
          <>
            <div className="user-info">
              <span className="display-name">{displayName}</span>
              <span className="username">{username}</span>
            </div>
            <button onClick={onLogout} className="logout-button">Sign Out</button>
          </>
        ) : (
          <button onClick={() => navigateAndClose('login')} className="login-button">Sign In</button>
        )}
      </div>
      
      {/* Mobile menu backdrop */}
      {mobileMenuOpen && (
        <div className="mobile-backdrop" onClick={toggleMobileMenu}></div>
      )}
    </nav>
  );
};

export default Navigation;