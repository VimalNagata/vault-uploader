import React from 'react';
import './Dashboard.css';

interface DashboardProps {
  username: string;
  onNavigate: (page: string) => void;
}

const Dashboard: React.FC<DashboardProps> = ({ username, onNavigate }) => {
  return (
    <div className="dashboard-container">
      <h2>Welcome to Your Dee-en-eh Data Vault, {username}!</h2>
      
      <div className="dashboard-intro">
        <p>
          Your personal data vault allows you to securely upload, manage, and view your data
          in one centralized and protected location.
        </p>
      </div>
      
      <div className="dashboard-cards">
        <div className="dashboard-card">
          <h3>Upload Data</h3>
          <p>Use our tools to upload your data to secure storage.</p>
          <div className="card-options">
            <span>Options:</span>
            <ul>
              <li>Manual file uploads</li>
              <li>Email data import</li>
            </ul>
          </div>
          <button onClick={() => onNavigate('upload')}>Go to Upload</button>
        </div>
        
        <div className="dashboard-card">
          <h3>View Your Data</h3>
          <p>View and manage the data you've uploaded to our system.</p>
          <div className="card-options">
            <span>Features:</span>
            <ul>
              <li>Browse all files</li>
              <li>Download data</li>
              <li>Organize by category</li>
            </ul>
          </div>
          <button onClick={() => onNavigate('view')}>View My Data</button>
        </div>
      </div>
      
      <div className="dashboard-help">
        <h3>Need Help?</h3>
        <p>
          If you have questions about your Dee-en-eh Data Vault or need assistance,
          please contact our support team at <a href="mailto:support@deeeneh.com">support@deeeneh.com</a>.
        </p>
      </div>
    </div>
  );
};

export default Dashboard;