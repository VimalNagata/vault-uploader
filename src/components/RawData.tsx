import React, { useEffect, useState } from "react";
import "./RawData.css";
import S3Service, { DataStage } from "../services/S3Service";
import FileTree from "./FileTree";

interface RawDataProps {
  username: string;
}

const RawData: React.FC<RawDataProps> = ({ username }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [fileTree, setFileTree] = useState<any>(null);
  const [rawFiles, setRawFiles] = useState<any[]>([]);
  const [selectedFile, setSelectedFile] = useState<any>(null);
  const [totalStorage, setTotalStorage] = useState("0 MB");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<any>(null);

  // Utility function to format file sizes
  const formatBytes = (bytes: number, decimals: number = 2): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
  };

  // Function to load user data
  const loadUserData = async () => {
    setIsLoading(true);

    try {
      // Use the metrics API
      const userData = await S3Service.getUserDataMetrics(username, DataStage.YOUR_DATA);
      
      // Extract metrics
      const { metrics, fileTree, files } = userData;
      
      console.log(`Retrieved metrics: ${metrics.fileCount} files, ${metrics.totalSizeFormatted} total size`);
      
      // Save file tree and raw files for later use
      setFileTree(fileTree);
      setRawFiles(files);
      
      // Update total storage directly from metrics
      setTotalStorage(metrics.totalSizeFormatted);
    } catch (error) {
      console.error("Error loading raw data:", error);
      // Set empty file tree and raw files
      setFileTree({ 
        name: 'root', 
        type: 'folder', 
        children: [], 
        size: 0 
      });
      
      setRawFiles([]);
      setTotalStorage("0 MB (API Error)");
    } finally {
      setIsLoading(false);
    }
  };

  // Function to categorize a file
  const analyzeFile = async () => {
    if (!selectedFile) return;
    
    try {
      setIsAnalyzing(true);
      
      // Call the categorization Lambda function via S3Service
      const result = await S3Service.categorizeFile(
        username,
        selectedFile.key,
        selectedFile.name
      );
      
      setAnalysisResult(result);
      console.log("Analysis result:", result);
      
      // Show success message
      alert(`File analyzed successfully!\nCategories: ${result.categories.join(', ')}`);
    } catch (error) {
      console.error("Error analyzing file:", error);
      alert(`Error analyzing file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  useEffect(() => {
    loadUserData();
  }, [username]);

  return (
    <div className="raw-data-page">
      <div className="raw-data-header">
        <h2>Raw Data Files</h2>
        <p>Browse and download your uploaded data files</p>
      </div>

      {isLoading ? (
        <div className="loading-indicator">
          <div className="spinner"></div>
          <p>Loading your files...</p>
        </div>
      ) : (
        <div className="raw-data-content">
          <div className="raw-data-info">
            <div className="info-stats">
              <div className="info-stat">
                <span className="stat-value">{rawFiles.length || 0}</span>
                <span className="stat-label">Files</span>
              </div>
              <div className="stat-divider"></div>
              <div className="info-stat">
                <span className="stat-value">{totalStorage}</span>
                <span className="stat-label">Total Size</span>
              </div>
            </div>
          </div>

          <div className="raw-data-main">
            <div className="file-browser">
              <div className="file-browser-header">
                <h3>File Browser</h3>
              </div>
              <div className="file-browser-content">
                {fileTree && fileTree.children && fileTree.children.length > 0 ? (
                  <FileTree 
                    data={fileTree} 
                    onFileClick={(file) => {
                      console.log('File clicked:', file);
                      setSelectedFile(file);
                      setAnalysisResult(null); // Reset analysis result when selecting new file
                    }}
                  />
                ) : (
                  <div className="no-files-message">
                    <p>No files have been uploaded yet. Upload files from the Dashboard to see them here.</p>
                  </div>
                )}
              </div>
            </div>

            <div className="file-details-panel">
              {selectedFile ? (
                <div className="file-details">
                  <h3>{selectedFile.name}</h3>
                  <div className="file-path">{selectedFile.key}</div>
                  <div className="file-properties">
                    <p><strong>Size:</strong> {formatBytes(selectedFile.size)}</p>
                    <p><strong>Last Modified:</strong> {selectedFile.lastModified ? new Date(selectedFile.lastModified).toLocaleString() : 'Unknown'}</p>
                    <p><strong>Type:</strong> {selectedFile.type || 'Unknown'}</p>
                  </div>
                  
                  <div className="file-actions">
                    <button 
                      className="file-action-button"
                      onClick={() => alert('Download functionality coming soon!')}
                    >
                      Download
                    </button>
                    
                    <button 
                      className="file-action-button analyze-button"
                      onClick={analyzeFile}
                      disabled={isAnalyzing}
                    >
                      {isAnalyzing ? 'Analyzing...' : 'Analyze with AI'}
                    </button>
                  </div>
                  
                  {isAnalyzing && (
                    <div className="analysis-progress">
                      <div className="spinner small"></div>
                      <span>Analyzing file content with AI... This may take a minute.</span>
                    </div>
                  )}
                  
                  {analysisResult && (
                    <div className="analysis-result">
                      <h4>Analysis Result</h4>
                      <p><strong>File Type:</strong> {analysisResult.fileType || 'Unknown'}</p>
                      <p><strong>Summary:</strong> {analysisResult.summary}</p>
                      <p><strong>Categories:</strong> {Object.keys(analysisResult.categories).join(', ')}</p>
                      
                      {analysisResult.insights && analysisResult.insights.length > 0 && (
                        <div className="analysis-insights">
                          <strong>Insights:</strong>
                          <ul>
                            {analysisResult.insights.map((insight: string, index: number) => (
                              <li key={index}>{insight}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      
                      {analysisResult.sensitiveInfo && (
                        <div className="sensitive-info-warning">
                          <p><strong>⚠️ Note:</strong> This file may contain sensitive information.</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="no-selection">
                  <p>Select a file from the browser to view details</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RawData;