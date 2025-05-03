import React, { useState } from 'react';
import './Login.css';

interface LoginProps {
  onLogin: (username: string) => void;
}

const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!username.trim()) {
      setError('Please enter a username');
      return;
    }
    
    if (!password) {
      setError('Please enter a password');
      return;
    }
    
    // Hardcoded password check
    if (password !== 'w1234ard') {
      setError('Invalid password');
      return;
    }
    
    // Login successful
    setError(null);
    onLogin(username);
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <h2>Dee-en-eh Data Vault</h2>
        <p className="login-subtitle">Sign in to securely access your personal data vault</p>
        
        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label htmlFor="username">Username</label>
            <input
              type="text"
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter your username"
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
            />
          </div>
          
          {error && <div className="login-error">{error}</div>}
          
          <button type="submit" className="login-button">Sign In</button>
        </form>
        
        <div className="login-help">
          <p>Need help? Contact <a href="mailto:support@example.com">support@example.com</a></p>
          <p className="login-note">
            This is a secure vault for storing and managing your personal data.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;