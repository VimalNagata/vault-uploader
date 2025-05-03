import React from 'react';
import './Navigation.css';

interface NavigationProps {
  username: string;
  currentPage: string;
  onNavigate: (page: string) => void;
  onLogout: () => void;
}

const Navigation: React.FC<NavigationProps> = ({ 
  username, 
  currentPage, 
  onNavigate, 
  onLogout 
}) => {
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
        <span className="username">{username}</span>
        <button onClick={onLogout} className="logout-button">Sign Out</button>
      </div>
    </nav>
  );
};

export default Navigation;