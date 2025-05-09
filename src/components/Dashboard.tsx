import React, { useEffect, useState } from "react";
import "./Dashboard.css";
import S3Service, { DataStage, getUserStagePath } from "../services/S3Service";

interface UserInfo {
  email: string;
  name?: string;
  picture?: string;
  given_name?: string;
  family_name?: string;
  provider: string;
}

interface FileCategory {
  name: string;
  icon: string;
  count: number;
  size: string;
  lastUpdated: string;
}

interface Persona {
  id: string;
  name: string;
  type: string;
  completeness: number;
  lastUpdated: string;
}

interface DashboardProps {
  username: string;
  onNavigate: (page: string) => void;
}

// Function to traverse the file tree and flatten folder structures
const traverseFileTree = async (entries: any[]): Promise<File[]> => {
  const allFiles: File[] = [];
  
  // Helper function to recursively process entries
  const processEntry = (entry: any, path: string): Promise<void> => {
    return new Promise((resolve) => {
      if (entry.isFile) {
        // It's a file, get it and add it to our list with path prefix
        entry.file((file: File) => {
          // Create a new file with the path embedded in the name
          const pathParts = path.split('/').filter(p => p);
          
          // Only modify name if we have a path
          if (pathParts.length > 0) {
            // Create a flattened name with folder paths
            const flatName = pathParts.join('_') + '_' + file.name;
            
            // Create a new File object with the flattened name
            const renamedFile = new File(
              [file], 
              flatName,
              { type: file.type, lastModified: file.lastModified }
            );
            
            allFiles.push(renamedFile);
            console.log(`Added file: ${renamedFile.name} (original: ${path}/${file.name})`);
          } else {
            // No path, just add the original file
            allFiles.push(file);
          }
          resolve();
        }, (error: any) => {
          console.error("Error getting file:", error);
          resolve();
        });
      } else if (entry.isDirectory) {
        // It's a directory, create a new path and read its contents
        const dirReader = entry.createReader();
        const readEntries = () => {
          dirReader.readEntries(async (entries: any[]) => {
            if (entries.length) {
              // Process all entries in this directory
              const promises = entries.map(e => processEntry(e, path + '/' + entry.name));
              await Promise.all(promises);
              readEntries(); // Continue reading if we have more entries
            } else {
              resolve(); // No more entries, we're done with this directory
            }
          }, (error: any) => {
            console.error("Error reading directory:", error);
            resolve();
          });
        };
        readEntries();
      }
    });
  };
  
  // Process all root entries in parallel
  await Promise.all(entries.map(entry => processEntry(entry, '')));
  return allFiles;
};

const Dashboard: React.FC<DashboardProps> = ({ username, onNavigate }) => {
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [fileCategories, setFileCategories] = useState<FileCategory[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [totalStorage, setTotalStorage] = useState("0 MB");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Function to load user data - declaring at the top level for use in multiple places
  const loadUserData = async () => {
    setIsLoading(true);

    try {
      // Load file count from S3 stage1 (raw data) - just to get a real count if available
      const stagePath = getUserStagePath(username, DataStage.RAW_DATA);
      const files = await S3Service.listFiles(stagePath);
      const totalFiles = files.length;
      
      console.log(`Found ${totalFiles} files in ${stagePath}`);

      // Create mock data categories based on real file count if available
      const mockCategories: FileCategory[] = [
        {
          name: "Social Media",
          icon: "social",
          count: Math.max(Math.floor(totalFiles * 0.4), 0),
          size: "24.6 MB",
          lastUpdated: "2 days ago",
        },
        {
          name: "Financial",
          icon: "financial",
          count: Math.max(Math.floor(totalFiles * 0.2), 0),
          size: "12.3 MB",
          lastUpdated: "5 days ago",
        },
        {
          name: "Professional",
          icon: "professional",
          count: Math.max(Math.floor(totalFiles * 0.3), 0),
          size: "18.9 MB",
          lastUpdated: "1 week ago",
        },
        {
          name: "Entertainment",
          icon: "entertainment",
          count: Math.max(Math.floor(totalFiles * 0.1), 0),
          size: "9.1 MB",
          lastUpdated: "2 weeks ago",
        },
      ];

      // Mock personas
      const mockPersonas: Persona[] = [
        {
          id: "p1",
          name: "Professional Profile",
          type: "Career",
          completeness: 85,
          lastUpdated: "3 days ago",
        },
        {
          id: "p2",
          name: "Financial Profile",
          type: "Financial",
          completeness: 60,
          lastUpdated: "1 week ago",
        },
        {
          id: "p3",
          name: "Social Presence",
          type: "Social",
          completeness: 70,
          lastUpdated: "5 days ago",
        },
      ];

      // Calculate total storage
      const totalStorageNum = mockCategories.reduce((acc, cat) => {
        const sizeNum = parseFloat(cat.size.split(" ")[0]);
        return acc + sizeNum;
      }, 0);

      setFileCategories(mockCategories);
      setPersonas(mockPersonas);
      setTotalStorage(`${totalStorageNum.toFixed(1)} MB`);
    } catch (error) {
      console.error("Error loading dashboard data:", error);
      // Fallback to mock data if S3 fails
      setFileCategories([
        {
          name: "Social Media",
          icon: "social",
          count: 5,
          size: "24.6 MB",
          lastUpdated: "2 days ago",
        },
        {
          name: "Financial",
          icon: "financial",
          count: 3,
          size: "12.3 MB",
          lastUpdated: "5 days ago",
        },
        {
          name: "Professional",
          icon: "professional",
          count: 4,
          size: "18.9 MB",
          lastUpdated: "1 week ago",
        },
        {
          name: "Entertainment",
          icon: "entertainment",
          count: 2,
          size: "9.1 MB",
          lastUpdated: "2 weeks ago",
        },
      ]);
      setPersonas([
        {
          id: "p1",
          name: "Professional Profile",
          type: "Career",
          completeness: 85,
          lastUpdated: "3 days ago",
        },
        {
          id: "p2",
          name: "Financial Profile",
          type: "Financial",
          completeness: 60,
          lastUpdated: "1 week ago",
        },
        {
          id: "p3",
          name: "Social Presence",
          type: "Social",
          completeness: 70,
          lastUpdated: "5 days ago",
        },
      ]);
      setTotalStorage("64.9 MB");
    } finally {
      setIsLoading(false);
    }
  };

  // Function to handle file uploads directly from the dashboard
  const handleFileUpload = async (files: File[]) => {
    if (!files.length) return;

    setIsUploading(true);
    setUploadProgress(0);

    try {
      // Simulate upload progress
      const timer = setInterval(() => {
        setUploadProgress((prev) => {
          if (prev >= 95) {
            clearInterval(timer);
            return prev;
          }
          return prev + Math.floor(Math.random() * 10);
        });
      }, 300);

      // Get raw data stage path
      const stagePath = getUserStagePath(username, DataStage.RAW_DATA);
      
      // Create relative paths within the stage1 folder 
      const paths = files.map(() => "");

      // Actually upload files using S3Service
      await S3Service.uploadFolder(files, stagePath, paths);

      // Complete the upload
      clearInterval(timer);
      setUploadProgress(100);

      // Short timeout to show 100% complete
      setTimeout(() => {
        setIsUploading(false);
        setUploadProgress(0);

        // Refresh data
        loadUserData();
      }, 500);
    } catch (error) {
      console.error("Error uploading files:", error);
      setIsUploading(false);
      setUploadProgress(0);
      // TODO: Add error notification
    }
  };

  useEffect(() => {
    // Get user info from localStorage if available
    const savedUserInfo = localStorage.getItem("dna_user_info");
    if (savedUserInfo) {
      try {
        const parsedUserInfo = JSON.parse(savedUserInfo);
        setUserInfo(parsedUserInfo);
      } catch (err) {
        console.error("Failed to parse user info from localStorage", err);
      }
    }

    loadUserData();
  }, [username]);

  const displayName =
    userInfo?.given_name || userInfo?.name?.split(" ")[0] || username;

  // Icon component to show the different data category icons
  const CategoryIcon: React.FC<{ type: string }> = ({ type }) => {
    switch (type) {
      case "social":
        return (
          <div className="category-icon social">
            <svg
              viewBox="0 0 24 24"
              width="24"
              height="24"
              stroke="#0a66c2"
              strokeWidth="2"
              fill="none"
            >
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="9" cy="7" r="4"></circle>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
            </svg>
          </div>
        );
      case "financial":
        return (
          <div className="category-icon financial">
            <svg
              viewBox="0 0 24 24"
              width="24"
              height="24"
              stroke="#057642"
              strokeWidth="2"
              fill="none"
            >
              <line x1="12" y1="1" x2="12" y2="23"></line>
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
            </svg>
          </div>
        );
      case "professional":
        return (
          <div className="category-icon professional">
            <svg
              viewBox="0 0 24 24"
              width="24"
              height="24"
              stroke="#0a66c2"
              strokeWidth="2"
              fill="none"
            >
              <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
              <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
            </svg>
          </div>
        );
      case "entertainment":
        return (
          <div className="category-icon entertainment">
            <svg
              viewBox="0 0 24 24"
              width="24"
              height="24"
              stroke="#0a66c2"
              strokeWidth="2"
              fill="none"
            >
              <polygon points="23 7 16 12 23 17 23 7"></polygon>
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
            </svg>
          </div>
        );
      default:
        return (
          <div className="category-icon default">
            <svg
              viewBox="0 0 24 24"
              width="24"
              height="24"
              stroke="#0a66c2"
              strokeWidth="2"
              fill="none"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
              <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
          </div>
        );
    }
  };

  // Progress bar component for personas
  const ProgressBar: React.FC<{ percentage: number; type: string }> = ({
    percentage,
    type,
  }) => {
    const getColor = () => {
      switch (type) {
        case "Career":
          return "#0a66c2";
        case "Financial":
          return "#057642";
        case "Social":
          return "#0a66c2";
        default:
          return "#0a66c2";
      }
    };

    return (
      <div className="progress-bar-container">
        <div
          className="progress-bar-fill"
          style={{
            width: `${percentage}%`,
            backgroundColor: getColor(),
          }}
        ></div>
        <span className="progress-text">{percentage}% Complete</span>
      </div>
    );
  };

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <div className="dashboard-welcome">
          <h2>Welcome back, {displayName}</h2>
          <p className="dashboard-subtitle">
            Here's an overview of your Digital DNA vault
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="loading-indicator">
          <div className="spinner"></div>
          <p>Loading your data...</p>
        </div>
      ) : (
        <>
          {/* Upload Progress Indicator (only shown when uploading) */}
          {isUploading && (
            <div className="upload-progress-bar">
              <div className="progress-bar-container">
                <div
                  className="progress-bar-fill"
                  style={{
                    width: `${uploadProgress}%`,
                    backgroundColor: "#0a66c2",
                  }}
                ></div>
              </div>
              <span className="progress-text">{uploadProgress}% Uploaded</span>
            </div>
          )}

          <div className="dashboard-sections">
            {/* Raw Data Upload Section */}
            <div className="dashboard-section">
              <div className="section-header">
                <h3>Raw Data</h3>
              </div>
              <div className="raw-data-container">
                <div className="metrics-container">
                  <div className="summary-stats">
                    <div className="summary-stat">
                      <span className="stat-value">
                        {fileCategories.reduce(
                          (acc, cat) => acc + cat.count,
                          0
                        )}
                      </span>
                      <span className="stat-label">Files Uploaded</span>
                    </div>
                    <div className="stat-divider"></div>
                    <div className="summary-stat">
                      <span className="stat-value">{totalStorage}</span>
                      <span className="stat-label">Total Storage</span>
                    </div>
                  </div>
                </div>

                {/* Dropzone Upload Area */}
                <div
                  className="dropzone-area"
                  onClick={() =>
                    document.getElementById("file-upload-input")?.click()
                  }
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const el = e.currentTarget;
                    el.classList.add("active");
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const el = e.currentTarget;
                    el.classList.remove("active");
                  }}
                  onDrop={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const el = e.currentTarget;
                    el.classList.remove("active");

                    // Handle files from drop event
                    if (e.dataTransfer.items) {
                      setIsUploading(true);
                      setUploadProgress(0);
                      
                      try {
                        const fileList: File[] = [];
                        const entries: any[] = [];
                        
                        // Collect all the dropped items
                        for (let i = 0; i < e.dataTransfer.items.length; i++) {
                          const item = e.dataTransfer.items[i];
                          if (item.kind === "file") {
                            const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
                            
                            if (entry) {
                              entries.push(entry);
                            } else {
                              // Fallback for browsers that don't support webkitGetAsEntry
                              const file = item.getAsFile();
                              if (file) fileList.push(file);
                            }
                          }
                        }
                        
                        // Process entries that might be files or directories
                        if (entries.length > 0) {
                          const processedFiles = await traverseFileTree(entries);
                          fileList.push(...processedFiles);
                        }
                        
                        console.log(`Found ${fileList.length} files to upload`);
                        
                        if (fileList.length > 0) {
                          handleFileUpload(fileList);
                        } else {
                          setIsUploading(false);
                        }
                      } catch (error) {
                        console.error("Error processing dropped items:", error);
                        setIsUploading(false);
                      }
                    }
                  }}
                >
                  <div className="upload-icon"></div>
                  <div className="dropzone-text">
                    <h4>Drag & drop files or folders here</h4>
                    <p>Upload CCPA data to enrich your Digital DNA profile</p>
                  </div>
                </div>
              </div>

              <input
                type="file"
                id="file-upload-input"
                multiple
                webkitdirectory="true"
                directory=""
                style={{ display: "none" }}
                onChange={(e) => {
                  if (e.target.files?.length) {
                    const fileList = Array.from(e.target.files);
                    
                    // Process files and flatten folder structure
                    const processedFiles = fileList.map(file => {
                      // For input[webkitdirectory], files have a webkitRelativePath property
                      const relativePath = (file as any).webkitRelativePath;
                      
                      if (relativePath) {
                        // Get all directory parts except the filename
                        const pathParts = relativePath.split('/');
                        const fileName = pathParts.pop(); // Remove filename
                        
                        if (pathParts.length > 0) {
                          // Create flattened filename with directory structure
                          const flatName = pathParts.join('_') + '_' + fileName;
                          
                          // Create new file with flattened name
                          return new File(
                            [file],
                            flatName,
                            { type: file.type, lastModified: file.lastModified }
                          );
                        }
                      }
                      
                      // Return original file if no path processing needed
                      return file;
                    });
                    
                    handleFileUpload(processedFiles);
                  }
                }}
              />
            </div>

            {/* Data Categories Section */}
            <div className="dashboard-section">
              <div className="section-header">
                <h3>Data Categories ({fileCategories.length})</h3>
              </div>

              <div className="category-cards">
                {fileCategories.map((category, index) => (
                  <div className="category-card" key={index}>
                    <CategoryIcon type={category.icon} />
                    <div className="category-info">
                      <h4>{category.name}</h4>
                      <div className="category-meta">
                        <span>{category.count} files</span>
                        <span className="dot-separator">•</span>
                        <span>{category.size}</span>
                      </div>
                      <div className="category-updated">
                        Updated {category.lastUpdated}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Personas Section */}
            <div className="dashboard-section">
              <div className="section-header">
                <h3>Your Personas ({personas.length})</h3>
              </div>

              <div className="persona-cards">
                {personas.map((persona) => (
                  <div className="persona-card" key={persona.id}>
                    <div className="persona-header">
                      <h4>{persona.name}</h4>
                      <span className="persona-type">{persona.type}</span>
                    </div>
                    <ProgressBar
                      percentage={persona.completeness}
                      type={persona.type}
                    />
                    <div className="persona-footer">
                      <span>Updated {persona.lastUpdated}</span>
                      <div className="persona-status">Auto-updating</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default Dashboard;
