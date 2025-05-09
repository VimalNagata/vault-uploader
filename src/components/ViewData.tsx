import React, { useState, useEffect } from 'react';
import './ViewData.css';
import S3Service, { DataStage, getUserStagePath } from '../services/S3Service';

interface ViewDataProps {
  username: string;
}

interface S3File {
  Key?: string;
  LastModified?: Date;
  Size?: number;
  ETag?: string;
}

const ViewData: React.FC<ViewDataProps> = ({ username }) => {
  const [userFiles, setUserFiles] = useState<S3File[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedStage, setSelectedStage] = useState<DataStage>(DataStage.RAW_DATA);
  const [searchTerm, setSearchTerm] = useState<string>('');

  useEffect(() => {
    fetchUserFiles();
  }, [username, selectedStage]);

  const fetchUserFiles = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      // Get the path for the selected stage
      const stagePath = getUserStagePath(username, selectedStage);
      console.log(`Fetching files from stage path: ${stagePath}`);
      
      // List files from the selected stage
      const files = await S3Service.listFiles(stagePath);
      setUserFiles(files);
      
      console.log('Files loaded:', files.length);
    } catch (err) {
      console.error('Error listing files:', err);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(`Failed to list files: ${errorMessage}`);
    } finally {
      setIsLoading(false);
    }
  };

  const getFileCategory = (key: string | undefined): string => {
    if (!key) return 'other';
    
    if (key.includes('/emails/')) return 'emails';
    if (key.includes('/documents/')) return 'documents';
    if (key.includes('/images/')) return 'images';
    
    // Check file extension for categorization
    const extension = key.split('.').pop()?.toLowerCase();
    if (['jpg', 'jpeg', 'png', 'gif'].includes(extension || '')) return 'images';
    if (['pdf', 'doc', 'docx', 'txt'].includes(extension || '')) return 'documents';
    
    return 'other';
  };

  const formatDate = (date: Date | undefined): string => {
    if (!date) return 'Unknown date';
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatSize = (size: number | undefined): string => {
    if (size === undefined) return 'Unknown size';
    
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(2)} KB`;
    return `${(size / (1024 * 1024)).toFixed(2)} MB`;
  };

  const filteredFiles = userFiles.filter(file => {
    // Skip folder-only paths
    if (file.Key && file.Key.endsWith('/')) return false;
    
    // Extract relative path
    const key = file.Key || '';
    const basePath = `${username}/${selectedStage}/`;
    const relativePath = key.startsWith(basePath) 
      ? key.substring(basePath.length) 
      : key;
    
    // Filter by category if not "all"
    const category = getFileCategory(key);
    if (selectedCategory !== 'all' && category !== selectedCategory) return false;
    
    // Filter by search term
    if (searchTerm && !relativePath.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    
    return true;
  });

  return (
    <div className="view-data-container">
      <div className="view-header">
        <h2>Your Vault Contents</h2>
        <button onClick={fetchUserFiles} className="refresh-button">
          {isLoading ? 'Loading...' : 'Refresh Data'}
        </button>
      </div>
      
      <div className="view-filters">
        <div className="filter-group">
          <label htmlFor="stage-filter">Data Stage:</label>
          <select
            id="stage-filter"
            value={selectedStage}
            onChange={(e) => setSelectedStage(e.target.value as DataStage)}
          >
            <option value={DataStage.RAW_DATA}>Raw Data (Stage 1)</option>
            <option value={DataStage.CATEGORIZED}>Categorized (Stage 2)</option>
            <option value={DataStage.PERSONAS}>Personas (Stage 99)</option>
          </select>
        </div>
        
        <div className="filter-group">
          <label htmlFor="category-filter">Filter by Category:</label>
          <select 
            id="category-filter" 
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
          >
            <option value="all">All Files</option>
            <option value="emails">Emails</option>
            <option value="documents">Documents</option>
            <option value="images">Images</option>
            <option value="other">Other</option>
          </select>
        </div>
        
        <div className="filter-group">
          <label htmlFor="search-filter">Search:</label>
          <input
            id="search-filter"
            type="text"
            placeholder="Search files..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>
      
      {error && <div className="error-message">{error}</div>}
      
      {isLoading ? (
        <div className="loading-indicator">Loading your files...</div>
      ) : filteredFiles.length > 0 ? (
        <div className="files-table-container">
          <table className="files-table">
            <thead>
              <tr>
                <th>File Name</th>
                <th>Category</th>
                <th>Size</th>
                <th>Date Uploaded</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredFiles.map((file, index) => {
                const key = file.Key || '';
                const basePath = `${username}/${selectedStage}/`;
                const relativePath = key.startsWith(basePath) 
                  ? key.substring(basePath.length) 
                  : key;
                
                const fileName = relativePath.split('/').pop() || relativePath;
                const category = getFileCategory(key);
                
                return (
                  <tr key={index}>
                    <td className="file-name">{fileName}</td>
                    <td className="file-category">
                      <span className={`category-badge ${category}`}>
                        {category.charAt(0).toUpperCase() + category.slice(1)}
                      </span>
                    </td>
                    <td className="file-size">{formatSize(file.Size)}</td>
                    <td className="file-date">{formatDate(file.LastModified)}</td>
                    <td className="file-actions">
                      <button className="action-button view">View</button>
                      <button className="action-button download">Download</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="no-files-message">
          <p>No files found matching your criteria.</p>
          {selectedCategory !== 'all' || searchTerm ? (
            <p>Try changing your filters or upload some files first.</p>
          ) : (
            <p>You haven't uploaded any files yet. Go to the Upload Data page to get started.</p>
          )}
        </div>
      )}
    </div>
  );
};

export default ViewData;