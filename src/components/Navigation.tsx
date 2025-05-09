import React, { useState } from 'react';
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
}

const Navigation: React.FC<NavigationProps> = ({ 
  username, 
  userInfo,
  currentPage, 
  onNavigate, 
  onLogout 
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const displayName = userInfo?.name || userInfo?.given_name || username;
  
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
      <div className="nav-logo" onClick={() => navigateAndClose('home')}>
        <h1>Digital DNA</h1>
      </div>
      
      <div className="mobile-menu-button" onClick={toggleMobileMenu}>
        <span></span>
        <span></span>
        <span></span>
      </div>
      
      <ul className={`nav-links ${mobileMenuOpen ? 'mobile-open' : ''}`}>
        <li className={currentPage === 'home' ? 'active' : ''}>
          <button onClick={() => navigateAndClose('home')}>Home</button>
        </li>
        <li className={currentPage === 'dashboard' ? 'active' : ''}>
          <button onClick={() => navigateAndClose('dashboard')}>My Vault</button>
        </li>
        <li className={currentPage === 'upload' ? 'active' : ''}>
          <button onClick={() => navigateAndClose('upload')}>Upload Data</button>
        </li>
        <li className={currentPage === 'personas' ? 'active' : ''}>
          <button onClick={() => navigateAndClose('personas')}>My Personas</button>
        </li>
        <li className={currentPage === 'guides' ? 'active' : ''}>
          <button onClick={() => navigateAndClose('guides')}>Download Guides</button>
        </li>
      </ul>
      
      <div className="nav-user">
        {userInfo?.picture && (
          <img 
            src={userInfo.picture} 
            alt="Profile" 
            className="user-avatar" 
          />
        )}
        <div className="user-info">
          <span className="display-name">{displayName}</span>
          <span className="username">{username}</span>
        </div>
        <button onClick={onLogout} className="logout-button">Sign Out</button>
      </div>
      
      {/* Mobile menu backdrop */}
      {mobileMenuOpen && (
        <div className="mobile-backdrop" onClick={toggleMobileMenu}></div>
      )}
    </nav>
  );
};

export default Navigation;