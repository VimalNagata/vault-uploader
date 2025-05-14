import React, { useEffect, useState } from "react";
import "./CategoryDetail.css";
import S3Service, { DataStage } from "../services/S3Service";

// Define the structure for categorized data
interface CategorizedData {
  files: Record<string, any>;
  categoryTypes: string[];
  summaries?: Record<string, string>;
}

interface CategoryDetailProps {
  username: string;
  category: string;
  onBack: () => void;
}

interface CategoryFile {
  name: string;
  path: string;
  size: number;
  sizeFormatted: string;
  lastUpdated: string;
  tags?: string[];
  insights?: string[];
}

const CategoryDetail: React.FC<CategoryDetailProps> = ({ username, category, onBack }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [files, setFiles] = useState<CategoryFile[]>([]);
  const [summary, setSummary] = useState<string>("");
  const [insights, setInsights] = useState<string[]>([]);
  
  // Format file size
  const formatBytes = (bytes: number, decimals: number = 2): string => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + " " + sizes[i];
  };
  
  // Get relative time
  const getRelativeTimeString = (dateStr: string): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffSecs < 60) return "Just now";
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? "s" : ""} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
    
    return date.toLocaleDateString();
  };
  
  // Get category data
  useEffect(() => {
    const loadCategoryData = async () => {
      setIsLoading(true);
      
      try {
        // Fetch user data metrics, which includes categorized data
        const userData = await S3Service.getUserDataMetrics(
          username,
          DataStage.YOUR_DATA,
          true
        );
        
        // Extract categorized data
        const categorized = userData.categorized as CategorizedData | undefined;
        
        if (!categorized || !categorized.files) {
          setFiles([]);
          setSummary(`No data found for category: ${category}`);
          return;
        }
        
        const categoryFiles: CategoryFile[] = [];
        let categorySummary = "";
        const categoryInsights: string[] = [];
        
        // Process each file to find those in this category
        Object.entries(categorized.files).forEach(([filePath, fileData]: [string, any]) => {
          if (fileData.categories && fileData.categories[category.toLowerCase()]) {
            // Get category-specific data for this file
            const categoryData = fileData.categories[category.toLowerCase()];
            
            // Add file to our list
            categoryFiles.push({
              name: filePath.split('/').pop() || filePath,
              path: filePath,
              size: fileData.size || 0,
              sizeFormatted: formatBytes(fileData.size || 0),
              lastUpdated: getRelativeTimeString(fileData.lastUpdated || new Date()),
              tags: categoryData.tags || [],
              insights: categoryData.insights || []
            });
            
            // Collect insights for the category overview
            if (categoryData.insights && categoryData.insights.length > 0) {
              categoryData.insights.forEach((insight: string) => {
                if (!categoryInsights.includes(insight)) {
                  categoryInsights.push(insight);
                }
              });
            }
          }
        });
        
        // Get category summary if available
        if (categorized.summaries && categorized.summaries[category.toLowerCase()]) {
          categorySummary = categorized.summaries[category.toLowerCase()];
        } else {
          categorySummary = `Analysis of your ${category} data from various sources.`;
        }
        
        // Sort files by last updated, newest first
        categoryFiles.sort((a, b) => {
          return new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime();
        });
        
        setFiles(categoryFiles);
        setSummary(categorySummary);
        setInsights(categoryInsights);
        
      } catch (error) {
        console.error(`Error loading category data for ${category}:`, error);
        setFiles([]);
        setSummary(`Error loading data for category: ${category}`);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadCategoryData();
  }, [username, category]);
  
  return (
    <div className="category-detail-container">
      <div className="category-detail-header">
        <button className="back-button" onClick={onBack}>
          ← Back
        </button>
        <h2>{category.charAt(0).toUpperCase() + category.slice(1)} Data</h2>
      </div>
      
      {isLoading ? (
        <div className="loading-indicator">
          <div className="spinner"></div>
          <p>Loading category data...</p>
        </div>
      ) : (
        <>
          <div className="category-overview">
            <div className="overview-section">
              <h3>Summary</h3>
              <p>{summary}</p>
            </div>
            
            {insights.length > 0 && (
              <div className="overview-section">
                <h3>Key Insights</h3>
                <ul className="insights-list">
                  {insights.map((insight, index) => (
                    <li key={index}>{insight}</li>
                  ))}
                </ul>
              </div>
            )}
            
            <div className="overview-stats">
              <div className="stat-box">
                <span className="stat-value">{files.length}</span>
                <span className="stat-label">Files</span>
              </div>
              <div className="stat-box">
                <span className="stat-value">
                  {formatBytes(files.reduce((total, file) => total + file.size, 0))}
                </span>
                <span className="stat-label">Total Size</span>
              </div>
            </div>
          </div>
          
          <div className="category-files-section">
            <h3>Files in this Category</h3>
            
            {files.length === 0 ? (
              <div className="no-files-message">
                <p>No files found in this category.</p>
              </div>
            ) : (
              <div className="category-files-table">
                <div className="table-header">
                  <div className="file-name-col">Filename</div>
                  <div className="file-size-col">Size</div>
                  <div className="file-updated-col">Last Updated</div>
                  <div className="file-tags-col">Tags</div>
                </div>
                
                <div className="table-body">
                  {files.map((file, index) => (
                    <div className="table-row" key={index}>
                      <div className="file-name-col" title={file.path}>
                        {file.name}
                      </div>
                      <div className="file-size-col">{file.sizeFormatted}</div>
                      <div className="file-updated-col">{file.lastUpdated}</div>
                      <div className="file-tags-col">
                        {file.tags && file.tags.length > 0 ? (
                          <div className="tags-container">
                            {file.tags.slice(0, 3).map((tag, tagIdx) => (
                              <span className="file-tag" key={tagIdx}>
                                {tag}
                              </span>
                            ))}
                            {file.tags.length > 3 && (
                              <span className="more-tags">+{file.tags.length - 3}</span>
                            )}
                          </div>
                        ) : (
                          <span className="no-tags">No tags</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          
          {files.length > 0 && (
            <div className="file-insights-section">
              <h3>File-Specific Insights</h3>
              <div className="file-insights-list">
                {files.filter(file => file.insights && file.insights.length > 0)
                  .slice(0, 5)
                  .map((file, index) => (
                    <div className="file-insight-card" key={index}>
                      <h4>{file.name}</h4>
                      <ul>
                        {file.insights?.map((insight, insightIdx) => (
                          <li key={insightIdx}>{insight}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                
                {files.filter(file => file.insights && file.insights.length > 0).length === 0 && (
                  <div className="no-insights-message">
                    <p>No file-specific insights available for this category.</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default CategoryDetail;