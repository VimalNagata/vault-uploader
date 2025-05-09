import React from 'react';
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
  const displayName = userInfo?.name || userInfo?.given_name || username;
  
  return (
    <nav className="main-nav">
      <div className="nav-logo">
        <h1>Dee-en-eh Vault</h1>
      </div>
      
      <ul className="nav-links">
        <li className={currentPage === 'dashboard' ? 'active' : ''}>
          <button onClick={() => onNavigate('dashboard')}>Dashboard</button>
        </li>
        <li className={currentPage === 'upload' ? 'active' : ''}>
          <button onClick={() => onNavigate('upload')}>Upload Data</button>
        </li>
        <li className={currentPage === 'view' ? 'active' : ''}>
          <button onClick={() => onNavigate('view')}>View My Data</button>
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
    </nav>
  );
};

export default Navigation;