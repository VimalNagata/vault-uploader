import React, { useState } from 'react';
import ManualUploader from './ManualUploader';
import EmailUploader from './EmailUploader';
import './UploaderTabs.css';

interface UploaderTabsProps {
  username: string;
  onUploadComplete: () => void;
}

const UploaderTabs: React.FC<UploaderTabsProps> = ({ username, onUploadComplete }) => {
  const [activeTab, setActiveTab] = useState<'manual' | 'email'>('manual');

  return (
    <div className="tabs-container">
      <div className="tabs-header">
        <button 
          className={`tab-button ${activeTab === 'manual' ? 'active' : ''}`}
          onClick={() => setActiveTab('manual')}
        >
          Manual Upload
        </button>
        <button 
          className={`tab-button ${activeTab === 'email' ? 'active' : ''}`}
          onClick={() => setActiveTab('email')}
        >
          Email Upload
        </button>
      </div>
      
      <div className="tab-content">
        {activeTab === 'manual' ? (
          <ManualUploader username={username} onUploadComplete={onUploadComplete} />
        ) : (
          <EmailUploader username={username} />
        )}
      </div>
    </div>
  );
};

export default UploaderTabs;