import React, { useEffect, useState } from "react";
import "./Dashboard.css";
import S3Service, { DataStage, getUserStagePath } from "../services/S3Service";
import FileTree from "./FileTree";

// Helper function to get category summaries
const getCategorySummary = (categoryType: string): string => {
  const summaries: Record<string, string> = {
    social:
      "Your social media data includes profile information, posts, and interactions from various platforms.",
    financial:
      "Your financial data includes transactions, account information, and spending patterns.",
    professional:
      "Your professional data includes employment history, skills, and workplace interactions.",
    entertainment:
      "Your entertainment data includes media preferences, streaming history, and content interactions.",
    communication:
      "Your communication data includes messaging and email interactions with contacts.",
    location:
      "Your location data includes places visited, travel patterns, and location history.",
    shopping:
      "Your shopping data includes purchase history, preferences, and shopping patterns.",
    health:
      "Your health and wellness data includes fitness metrics, health records, and wellness activities.",
    search:
      "Your search data includes search queries, browsing history, and content interests.",
    device:
      "Your device data includes information about device usage, settings, and applications.",
  };

  return (
    summaries[categoryType] ||
    `Analysis of your ${categoryType} data from various sources.`
  );
};

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
  count: number | null; // Allow null for summary mode
  size: string | null; // Allow null for summary mode
  lastUpdated: string;
  fileExamples?: string[];
}

interface Persona {
  id: string;
  name: string;
  type: string;
  completeness: number;
  lastUpdated: string;
  summary?: string;
  insights?: string[];
  dataPoints?: string[];
  traits?: Record<string, any>;
  sources?: string[];
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
        entry.file(
          (file: File) => {
            // Create a new file with the path embedded in the name
            const pathParts = path.split("/").filter((p) => p);

            // Only modify name if we have a path
            if (pathParts.length > 0) {
              // Create a flattened name with folder paths using a dot delimiter
              const flatName = pathParts.join(".") + "." + file.name;

              // Create a new File object with the flattened name
              const renamedFile = new File([file], flatName, {
                type: file.type,
                lastModified: file.lastModified,
              });

              allFiles.push(renamedFile);
              console.log(
                `Added file: ${renamedFile.name} (original: ${path}/${file.name})`
              );
            } else {
              // No path, just add the original file
              allFiles.push(file);
            }
            resolve();
          },
          (error: any) => {
            console.error("Error getting file:", error);
            resolve();
          }
        );
      } else if (entry.isDirectory) {
        // It's a directory, create a new path and read its contents
        const dirReader = entry.createReader();
        const readEntries = () => {
          dirReader.readEntries(
            async (entries: any[]) => {
              if (entries.length) {
                // Process all entries in this directory
                const promises = entries.map((e) =>
                  processEntry(e, path + "/" + entry.name)
                );
                await Promise.all(promises);
                readEntries(); // Continue reading if we have more entries
              } else {
                resolve(); // No more entries, we're done with this directory
              }
            },
            (error: any) => {
              console.error("Error reading directory:", error);
              resolve();
            }
          );
        };
        readEntries();
      }
    });
  };

  // Process all root entries in parallel
  await Promise.all(entries.map((entry) => processEntry(entry, "")));
  return allFiles;
};

const Dashboard: React.FC<DashboardProps> = ({ username, onNavigate }) => {
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [fileCategories, setFileCategories] = useState<FileCategory[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [totalStorage, setTotalStorage] = useState("0 MB");
  // Define interface for enhanced metrics
  interface EnhancedMetrics {
    fileCount: number;
    totalSize: number;
    totalSizeFormatted: string;
    lastUpdated: string | null;
    stageMetrics?: {
      stage1: { fileCount: number; totalSize: number };
      stage2: { fileCount: number; totalSize: number };
      stage3: { fileCount: number; totalSize: number };
    };
    categoryCounts?: number;
    personaCounts?: number;
    personaTypes?: string[];
  }
  
  // Interface for User Master Profile
  interface UserMasterProfile {
    lastUpdated: string;
    fileCount: number;
    userProfile: {
      demographics?: {
        name?: string;
        age?: number;
        gender?: string;
        currentLocation?: string;
        previousLocations?: string[];
        birthDate?: string;
        maritalStatus?: string;
        familyMembers?: {
          spouse?: string;
          childrenCount?: number;
          children?: string[];
        };
      };
      financialMetrics?: {
        incomeRange?: string;
        savingsEstimate?: string;
        majorAssets?: string[];
        investmentTypes?: string[];
        creditScoreRange?: string;
        subscriptionsCount?: number;
        averageMonthlySpending?: string;
      };
      professionalMetrics?: {
        currentEmployer?: string;
        currentTitle?: string;
        yearsExperience?: number;
        employerCount?: number;
        highestEducation?: string;
        skills?: string[];
      };
      socialMetrics?: {
        connectionsCount?: number;
        platformsUsed?: string[];
        primaryPlatform?: string;
        activityFrequency?: string;
      };
      healthMetrics?: {
        conditions?: string[];
        height?: string;
        weight?: string;
        exerciseFrequency?: string;
      };
      travelMetrics?: {
        tripsCount?: number;
        frequentDestinations?: string[];
        accommodationPreference?: string;
      };
      technologyMetrics?: {
        devicesOwned?: string[];
        operatingSystems?: string[];
        softwareUsed?: string[];
      };
      interests?: string[];
    };
    categories?: Record<string, {
      relevance: number;
      count: number;
      dataPoints: string[];
    }>;
    insights?: string[];
    sourceFiles?: Array<{
      fileName: string;
      fileType: string;
      processedAt: string;
      categories: string[];
    }>;
  }

  const [metrics, setMetrics] = useState<EnhancedMetrics | null>(null);
  const [userMasterProfile, setUserMasterProfile] = useState<UserMasterProfile | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // State for file tree
  const [fileTree, setFileTree] = useState<any>(null);
  const [rawFiles, setRawFiles] = useState<any[]>([]);

  // Utility function to format file sizes
  const formatBytes = (bytes: number, decimals: number = 2): string => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (
      parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + " " + sizes[i]
    );
  };

  // Utility function to calculate relative time
  const getRelativeTimeString = (date: Date | null): string => {
    if (!date) return "Never";

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    const diffWeeks = Math.floor(diffDays / 7);

    if (diffSecs < 60) return "Just now";
    if (diffMins < 60)
      return `${diffMins} minute${diffMins > 1 ? "s" : ""} ago`;
    if (diffHours < 24)
      return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
    if (diffWeeks < 5)
      return `${diffWeeks} week${diffWeeks > 1 ? "s" : ""} ago`;
    return date.toLocaleDateString();
  };

  // Process categorized data to create category cards
  const processCategorizedData = (categorized: any) => {
    const { files, categoryTypes } = categorized;

    if (!files || Object.keys(files).length === 0) {
      return [];
    }

    // Initialize category metrics with file examples array
    const categories: Record<
      string,
      {
        count: number;
        size: number;
        lastUpdated: string | null;
        fileExamples: string[];
      }
    > = {};

    // Process each categorized file
    Object.entries(files).forEach(([fileName, fileData]: [string, any]) => {
      if (fileData.categories) {
        // For each category in the file
        Object.keys(fileData.categories).forEach((category) => {
          if (!categories[category]) {
            categories[category] = {
              count: 0,
              size: 0,
              lastUpdated: null,
              fileExamples: [],
            };
          }

          // Increment count
          categories[category].count++;

          // Add file to examples if we have fewer than 5 examples
          if (categories[category].fileExamples.length < 5) {
            // Get simplified filename (remove path)
            const simpleName = fileName.split("/").pop() || fileName;
            if (!categories[category].fileExamples.includes(simpleName)) {
              categories[category].fileExamples.push(simpleName);
            }
          }

          // Update last updated if newer
          const fileDate = new Date(
            fileData.lastUpdated || new Date()
          ).toISOString();
          if (
            !categories[category].lastUpdated ||
            (categories[category].lastUpdated &&
              fileDate > (categories[category].lastUpdated || ""))
          ) {
            categories[category].lastUpdated = fileDate;
          }
        });
      }
    });

    // Create category cards
    return Object.entries(categories).map(([type, metrics]) => ({
      name: type.charAt(0).toUpperCase() + type.slice(1),
      icon: type,
      count: metrics.count,
      size: formatBytes(metrics.size || 0),
      lastUpdated: getRelativeTimeString(
        new Date(metrics.lastUpdated || new Date())
      ),
      fileExamples: metrics.fileExamples,
    }));
  };

  // Process personas data to create persona cards
  const processPersonas = (personas: Record<string, any>) => {
    if (!personas || Object.keys(personas).length === 0) {
      return [];
    }

    return Object.entries(personas).map(([type, data]) => ({
      id: type,
      name:
        data.name || `${type.charAt(0).toUpperCase() + type.slice(1)} Profile`,
      type: type.charAt(0).toUpperCase() + type.slice(1),
      completeness: data.completeness || 0,
      lastUpdated: getRelativeTimeString(
        new Date(data.lastUpdated || new Date())
      ),
      summary: data.summary || undefined,
      insights: data.insights || [],
      dataPoints: data.dataPoints || [],
      traits: data.traits || {},
      sources: data.sources || [],
    }));
  };

  // Function to load user data - declaring at the top level for use in multiple places
  const loadUserData = async () => {
    setIsLoading(true);

    try {
      // Use metrics API to get data from all stages with summary mode
      // This optimizes performance by reducing payload size
      const userData = await S3Service.getUserDataMetrics(
        username,
        DataStage.YOUR_DATA,
        true, // includeAllStages
        true, // summaryOnly - we only need metadata for the dashboard
        undefined, // No stage filter for initial load
        true // Skip file tree to reduce payload size
      );

      // Extract metrics and other data
      // Destructure with defaults to handle missing properties
      const {
        metrics,
        files,
        categorized = { files: {}, categoryTypes: [] },
        personas = null,
        userMasterProfile = null,
      } = userData;

      console.log(
        `Retrieved metrics: ${metrics.fileCount} files, ${metrics.totalSizeFormatted} total size`
      );
      console.log(
        `Data includes categorized: ${!!userData.categorized}, personas: ${!!userData.personas}, masterProfile: ${!!userData.userMasterProfile}`
      );
      
      // Set user master profile if available
      if (userData.userMasterProfile) {
        console.log("Setting user master profile from API response");
        setUserMasterProfile(userData.userMasterProfile);
      } else {
        console.log("No user master profile available in API response");
        setUserMasterProfile(null);
      }

      // Save metrics for use in the UI
      // Extract or calculate counts for dashboard sections
      const enhancedMetrics = {
        ...metrics,
        // Category counts - use categoryTypes array length first, then try counting files
        categoryCounts:
          categorized?.categoryTypes?.length ||
          (categorized?.files ? Object.keys(categorized.files).length : 0),
        // Persona counts - use direct count from personas object or personaTypes if available
        personaCounts: personas
          ? Object.keys(personas).length
          : userData.personaTypes
          ? userData.personaTypes.length
          : 0,
        // Store personaTypes for creating summary cards in summary mode
        personaTypes: personas
          ? Object.keys(personas)
          : userData.personaTypes && Array.isArray(userData.personaTypes)
          ? userData.personaTypes
          : [],
      };
      setMetrics(enhancedMetrics);

      // Initialize an empty file tree structure (will be populated on demand)
      setFileTree({
        name: "root",
        type: "folder",
        children: [],
        size: metrics.totalSize || 0,
      });

      // In summary mode, files might be empty - that's ok for the dashboard
      if (files) {
        setRawFiles(files);
      } else {
        console.log(
          "No files included in summary response (expected in summary mode)"
        );
        setRawFiles([]);
      }

      // Update total storage directly from metrics
      setTotalStorage(metrics.totalSizeFormatted);

      // Reset categories and personas arrays initially
      setFileCategories([]);
      setPersonas([]);

      // Update categories if available
      if (userData.categorized) {
        console.log("Processing categorized data from API response");

        // Check if we have detailed file data for categories
        if (categorized.files && Object.keys(categorized.files).length > 0) {
          const categoryData = processCategorizedData(categorized);
          if (categoryData.length > 0) {
            console.log(
              `Setting ${categoryData.length} categories in state from detailed data`
            );
            setFileCategories(categoryData);
          }
        }
        // If no detailed file data (likely summary mode) but we have categoryTypes
        else if (
          categorized.categoryTypes &&
          categorized.categoryTypes.length > 0
        ) {
          console.log(
            `Creating summary cards for ${categorized.categoryTypes.length} category types`
          );

          // Create basic category cards from the categoryTypes array
          const summaryCards = categorized.categoryTypes.map(
            (type: string) => ({
              name: type.charAt(0).toUpperCase() + type.slice(1),
              icon: type.toLowerCase(),
              count: null, // No count in summary mode - will hide the display
              size: null, // No size in summary mode - will hide the display
              lastUpdated: "Recently",
              fileExamples: [],
            })
          );

          setFileCategories(summaryCards);
        }
      } else {
        console.log("No valid categorized data found in API response");
      }

      // Update personas if available
      if (userData.personas) {
        console.log("Processing personas from API response");

        // If we have detailed persona data
        if (personas && Object.keys(personas).length > 0) {
          const personaData = processPersonas(personas);
          if (personaData.length > 0) {
            console.log(
              `Setting ${personaData.length} personas in state from detailed data`
            );
            setPersonas(personaData);
          }
        }
        // If we only have summary data but know persona types exist from the API response object
        else if (
          userData.personaTypes &&
          Array.isArray(userData.personaTypes) &&
          userData.personaTypes.length > 0
        ) {
          console.log(
            `Creating summary cards for ${userData.personaTypes.length} persona types from API response`
          );

          // Create basic persona cards from the personaTypes in the API response
          const summaryPersonas = userData.personaTypes.map((type: string) => ({
            id: type.toLowerCase(),
            name: `${type.charAt(0).toUpperCase() + type.slice(1)} Profile`,
            type: type.charAt(0).toUpperCase() + type.slice(1),
            completeness: 50, // Default placeholder value
            lastUpdated: "Recently",
            insights: [],
          }));

          setPersonas(summaryPersonas);
        }
      } else {
        console.log("No valid persona data found in API response");
      }

      // Format the last updated date
      const lastUpdated = metrics.lastUpdated
        ? new Date(metrics.lastUpdated)
        : null;

      const lastUpdatedRelative = lastUpdated
        ? getRelativeTimeString(lastUpdated)
        : "Never";

      // Only show real categories and personas from the API response
      // If no categories or personas are available, the UI will show empty lists
      console.log("Using only real data from the API response");

      // Note: No mock data is being used. If there's no real data,
      // the Dashboard will show empty category and persona sections.
    } catch (error) {
      console.error("Error loading dashboard data:", error);

      // No mock data - just show error state
      setFileCategories([]);
      setPersonas([]);
      setTotalStorage("0 MB (API Error)");

      // Set empty file tree and raw files
      setFileTree({
        name: "root",
        type: "folder",
        children: [],
        size: 0,
      });

      setRawFiles([]);
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

      // Get "Your Data" stage path
      const stagePath = getUserStagePath(username, DataStage.YOUR_DATA);

      // Create relative paths within the Your Data folder
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
  
  // User Master Profile Card Component
  const UserMasterProfileCard: React.FC<{ profile: UserMasterProfile }> = ({ profile }) => {
    // Helper function to render a metric if it exists
    const renderMetric = (label: string, value: any, icon?: string) => {
      if (value === undefined || value === null) return null;
      
      return (
        <div className="profile-metric">
          {icon && <span className="metric-icon">{icon}</span>}
          <span className="metric-label">{label}:</span>
          <span className="metric-value">
            {Array.isArray(value) 
              ? value.slice(0, 3).join(', ') + (value.length > 3 ? '...' : '')
              : value.toString()}
          </span>
        </div>
      );
    };

    // Helper function to render financial investments detail
    const renderFinancialDetails = (financialMetrics: Record<string, any>) => {
      if (!financialMetrics) return null;
      
      const { 
        incomeRange, 
        savingsEstimate, 
        majorAssets, 
        investmentTypes, 
        creditScoreRange,
        subscriptionsCount, 
        averageMonthlySpending,
        // Look for these specific investment insights that might be present
        investmentPortfolio,
        investmentValues,
        stockHoldings,
        retirementAccounts,
        realEstateInvestments,
        cryptoHoldings,
        netWorth,
        mortgageDetails,
        debtOverview
      } = financialMetrics;

      return (
        <div className="profile-section financial-details">
          <h4 className="section-title">
            <span className="section-icon">💰</span>
            Financial Profile
          </h4>

          <div className="financial-summary">
            {renderMetric("Income Range", incomeRange)}
            {renderMetric("Net Worth", netWorth)}
            {renderMetric("Savings", savingsEstimate)}
            {renderMetric("Credit Score", creditScoreRange)}
            {renderMetric("Monthly Spending", averageMonthlySpending)}
            {renderMetric("Subscriptions", subscriptionsCount)}
          </div>

          {/* Investments Section - Show only if we have investment data */}
          {(investmentTypes?.length > 0 || investmentPortfolio || stockHoldings || retirementAccounts || cryptoHoldings) && (
            <div className="financial-investments">
              <h5 className="subsection-title">Investment Portfolio</h5>
              
              {investmentPortfolio && (
                <div className="investment-details">
                  {typeof investmentPortfolio === 'string' 
                    ? renderMetric("Overview", investmentPortfolio)
                    : Object.entries(investmentPortfolio).map(([key, value], idx) => (
                        <div key={idx} className="investment-item">
                          {renderMetric(
                            key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase()),
                            value
                          )}
                        </div>
                      ))
                  }
                </div>
              )}

              {/* Stock Holdings */}
              {stockHoldings && (
                <div className="investment-category">
                  <h6 className="investment-category-title">Stocks</h6>
                  {typeof stockHoldings === 'string' 
                    ? <p>{stockHoldings}</p>
                    : Array.isArray(stockHoldings)
                      ? <ul className="investment-list">
                          {stockHoldings.slice(0, 5).map((stock: any, idx: number) => (
                            <li key={idx}>{stock}</li>
                          ))}
                          {stockHoldings.length > 5 && <li>...and {stockHoldings.length - 5} more</li>}
                        </ul>
                      : stockHoldings && typeof stockHoldings === 'object' && Object.entries(stockHoldings).map(([stock, details], idx: number) => (
                          <div key={idx} className="investment-item">
                            <strong>{stock}:</strong> 
                            {typeof details === 'object' && details !== null
                              ? Object.entries(details as Record<string, any>).map(([k, v]) => `${k}: ${v}`).join(', ')
                              : String(details)}
                          </div>
                        ))
                  }
                </div>
              )}

              {/* Retirement Accounts */}
              {retirementAccounts && (
                <div className="investment-category">
                  <h6 className="investment-category-title">Retirement</h6>
                  {typeof retirementAccounts === 'string' 
                    ? <p>{retirementAccounts}</p>
                    : Array.isArray(retirementAccounts)
                      ? <ul className="investment-list">
                          {retirementAccounts.map((account: any, idx: number) => (
                            <li key={idx}>{account}</li>
                          ))}
                        </ul>
                      : retirementAccounts && typeof retirementAccounts === 'object' && Object.entries(retirementAccounts).map(([account, details], idx: number) => (
                          <div key={idx} className="investment-item">
                            <strong>{account}:</strong> 
                            {typeof details === 'object' && details !== null
                              ? Object.entries(details as Record<string, any>).map(([k, v]) => `${k}: ${v}`).join(', ')
                              : String(details)}
                          </div>
                        ))
                  }
                </div>
              )}

              {/* Crypto Holdings */}
              {cryptoHoldings && (
                <div className="investment-category">
                  <h6 className="investment-category-title">Cryptocurrency</h6>
                  {typeof cryptoHoldings === 'string' 
                    ? <p>{cryptoHoldings}</p>
                    : Array.isArray(cryptoHoldings)
                      ? <ul className="investment-list">
                          {cryptoHoldings.map((crypto: any, idx: number) => (
                            <li key={idx}>{crypto}</li>
                          ))}
                        </ul>
                      : cryptoHoldings && typeof cryptoHoldings === 'object' && Object.entries(cryptoHoldings).map(([crypto, details], idx: number) => (
                          <div key={idx} className="investment-item">
                            <strong>{crypto}:</strong> 
                            {typeof details === 'object' && details !== null
                              ? Object.entries(details as Record<string, any>).map(([k, v]) => `${k}: ${v}`).join(', ')
                              : String(details)}
                          </div>
                        ))
                  }
                </div>
              )}

              {/* Real Estate Investments */}
              {realEstateInvestments && (
                <div className="investment-category">
                  <h6 className="investment-category-title">Real Estate</h6>
                  {typeof realEstateInvestments === 'string' 
                    ? <p>{realEstateInvestments}</p>
                    : Array.isArray(realEstateInvestments)
                      ? <ul className="investment-list">
                          {realEstateInvestments.map((property: any, idx: number) => (
                            <li key={idx}>{property}</li>
                          ))}
                        </ul>
                      : realEstateInvestments && typeof realEstateInvestments === 'object' && Object.entries(realEstateInvestments).map(([property, details], idx: number) => (
                          <div key={idx} className="investment-item">
                            <strong>{property}:</strong> 
                            {typeof details === 'object' && details !== null
                              ? Object.entries(details as Record<string, any>).map(([k, v]) => `${k}: ${v}`).join(', ')
                              : String(details)}
                          </div>
                        ))
                  }
                </div>
              )}

              {/* Investment Values if present */}
              {investmentValues && (
                <div className="investment-category">
                  <h6 className="investment-category-title">Investment Values</h6>
                  {typeof investmentValues === 'string' 
                    ? <p>{investmentValues}</p>
                    : Array.isArray(investmentValues)
                      ? <ul className="investment-list">
                          {investmentValues.map((value: any, idx: number) => (
                            <li key={idx}>{value}</li>
                          ))}
                        </ul>
                      : investmentValues && typeof investmentValues === 'object' && Object.entries(investmentValues).map(([category, value], idx: number) => (
                          <div key={idx} className="investment-item">
                            <strong>{category}:</strong> {String(value)}
                          </div>
                        ))
                  }
                </div>
              )}

              {/* Investment Types as a fallback */}
              {investmentTypes && investmentTypes.length > 0 && (
                <div className="investment-types">
                  <h6 className="investment-category-title">Investment Types</h6>
                  <div className="tag-list">
                    {investmentTypes.map((type: string, idx: number) => (
                      <span key={idx} className="investment-tag">{type}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Assets Section */}
          {majorAssets && majorAssets.length > 0 && (
            <div className="assets-section">
              <h5 className="subsection-title">Major Assets</h5>
              <ul className="assets-list">
                {majorAssets.map((asset: string, idx: number) => (
                  <li key={idx}>{asset}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Debt Overview */}
          {(debtOverview || mortgageDetails) && (
            <div className="debt-section">
              <h5 className="subsection-title">Debt Overview</h5>
              
              {debtOverview && (
                <div className="debt-overview">
                  {typeof debtOverview === 'string' 
                    ? <p>{debtOverview}</p>
                    : debtOverview && typeof debtOverview === 'object' && Object.entries(debtOverview).map(([type, details], idx: number) => (
                        <div key={idx} className="debt-item">
                          <strong>{type}:</strong> 
                          {typeof details === 'object' && details !== null
                            ? Object.entries(details as Record<string, any>).map(([k, v]) => `${k}: ${v}`).join(', ')
                            : String(details)}
                        </div>
                      ))
                  }
                </div>
              )}

              {mortgageDetails && (
                <div className="mortgage-details">
                  <h6 className="debt-category-title">Mortgage</h6>
                  {typeof mortgageDetails === 'string' 
                    ? <p>{mortgageDetails}</p>
                    : mortgageDetails && typeof mortgageDetails === 'object' && Object.entries(mortgageDetails).map(([key, value], idx: number) => (
                        <div key={idx} className="debt-item">
                          <strong>{key.replace(/([A-Z])/g, ' $1').replace(/^./, (str: string) => str.toUpperCase())}:</strong> {String(value)}
                        </div>
                      ))
                  }
                </div>
              )}
            </div>
          )}
        </div>
      );
    };
    
    // Helper function to render a metrics section if it has data
    const renderMetricsSection = (
      title: string, 
      metrics: Record<string, any> | undefined, 
      icon: string
    ) => {
      if (!metrics || Object.keys(metrics).filter(k => metrics[k] !== undefined).length === 0) {
        return null;
      }
      
      // Special handling for financial metrics to show detailed view
      if (title === "Financial") {
        return renderFinancialDetails(metrics);
      }
      
      return (
        <div className="profile-section">
          <h4 className="section-title">
            <span className="section-icon">{icon}</span>
            {title}
          </h4>
          <div className="section-metrics">
            {Object.entries(metrics).map(([key, value], idx) => {
              if (value === undefined) return null;
              // Format the key with proper capitalization and spacing
              const formattedKey = key
                .replace(/([A-Z])/g, ' $1')
                .replace(/^./, str => str.toUpperCase());
              return (
                <div key={idx} className="profile-metric">
                  <span className="metric-label">{formattedKey}:</span>
                  <span className="metric-value">
                    {Array.isArray(value) 
                      ? value.slice(0, 3).join(', ') + (value.length > 3 ? '...' : '')
                      : typeof value === 'object' && value !== null
                        ? JSON.stringify(value).slice(0, 50) + (JSON.stringify(value).length > 50 ? '...' : '')
                        : value.toString()}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      );
    };
    
    // Check if there are insights in the profile
    const hasInsights = profile.insights && profile.insights.length > 0;
    
    return (
      <div className="user-master-profile-card">
        <h3 className="profile-title">User Profile</h3>
        <div className="profile-updated">
          Last updated: {new Date(profile.lastUpdated).toLocaleDateString()}
        </div>
        
        {/* If there are insights, show them at the top */}
        {hasInsights && profile.insights && (
          <div className="profile-section insights-section">
            <h4 className="section-title">
              <span className="section-icon">💡</span>
              Key Insights
            </h4>
            <ul className="insights-list">
              {profile.insights.slice(0, 5).map((insight: string, index: number) => (
                <li key={index} className="insight-item">{insight}</li>
              ))}
            </ul>
          </div>
        )}
        
        {/* Demographics Section */}
        {profile.userProfile.demographics && (
          <div className="profile-section">
            <h4 className="section-title">
              <span className="section-icon">👤</span>
              Demographics
            </h4>
            <div className="section-metrics">
              {renderMetric("Name", profile.userProfile.demographics.name)}
              {renderMetric("Age", profile.userProfile.demographics.age)}
              {renderMetric("Gender", profile.userProfile.demographics.gender)}
              {renderMetric("Location", profile.userProfile.demographics.currentLocation)}
              {renderMetric("Marital Status", profile.userProfile.demographics.maritalStatus)}
              {profile.userProfile.demographics.familyMembers?.spouse && 
                renderMetric("Spouse", profile.userProfile.demographics.familyMembers.spouse)}
              {profile.userProfile.demographics.familyMembers?.childrenCount && 
                renderMetric("Children", profile.userProfile.demographics.familyMembers.childrenCount)}
              {profile.userProfile.demographics.previousLocations && profile.userProfile.demographics.previousLocations.length > 0 &&
                renderMetric("Previous Locations", profile.userProfile.demographics.previousLocations)}
            </div>
          </div>
        )}
        
        {/* Financial Metrics Section - Enhanced display */}
        {renderMetricsSection(
          "Financial", 
          profile.userProfile.financialMetrics, 
          "💰"
        )}
        
        {/* Professional Metrics Section */}
        {renderMetricsSection(
          "Professional", 
          profile.userProfile.professionalMetrics, 
          "💼"
        )}
        
        {/* Social Metrics Section */}
        {renderMetricsSection(
          "Social", 
          profile.userProfile.socialMetrics, 
          "👥"
        )}
        
        {/* Health Metrics Section */}
        {renderMetricsSection(
          "Health", 
          profile.userProfile.healthMetrics, 
          "🏥"
        )}
        
        {/* Travel Metrics Section */}
        {renderMetricsSection(
          "Travel", 
          profile.userProfile.travelMetrics, 
          "✈️"
        )}
        
        {/* Technology Metrics Section */}
        {renderMetricsSection(
          "Technology", 
          profile.userProfile.technologyMetrics, 
          "💻"
        )}
        
        {/* Interests Section */}
        {profile.userProfile.interests && profile.userProfile.interests.length > 0 && (
          <div className="profile-section">
            <h4 className="section-title">
              <span className="section-icon">⭐</span>
              Interests
            </h4>
            <div className="interests-list">
              {profile.userProfile.interests.map((interest, index) => (
                <span key={index} className="interest-tag">{interest}</span>
              ))}
            </div>
          </div>
        )}
        
        {/* Data Sources */}
        <div className="profile-footer">
          <span>Based on data from {profile.fileCount} files</span>
        </div>
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
        <div className="dashboard-actions">
          <button
            className="refresh-button"
            onClick={() => loadUserData()}
            disabled={isLoading}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="refresh-icon"
              style={{ marginRight: "8px" }}
            >
              <path d="M23 4v6h-6"></path>
              <path d="M1 20v-6h6"></path>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"></path>
              <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"></path>
            </svg>
            {isLoading ? "Loading..." : ""}
          </button>
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

          {/* Add a new layout div to contain the main sections and the right sidebar */}
          <div className="dashboard-layout">
            {/* Left side: Main sections */}
            <div className="dashboard-main">
              <div className="dashboard-sections">
                {/* Stage 1: Your Data Upload Section */}
                <div className="dashboard-section">
                  <div className="section-header">
                    <h3>Your Data</h3>
                    <button
                      className="secondary-button"
                      onClick={() => onNavigate("rawdata")}
                    >
                      View All Files
                    </button>
                  </div>
                  <div className="raw-data-container">
                    <div className="raw-data-left">
                      {/* Metrics */}
                      <div className="metrics-container">
                        <div className="summary-stats">
                          <div className="summary-stat">
                            <span className="stat-value">
                              {metrics ? metrics.fileCount : rawFiles.length || 0}
                            </span>
                            <span className="stat-label">Files Uploaded</span>
                          </div>
                          <div className="stat-divider"></div>
                          <div className="summary-stat">
                            <span className="stat-value">{totalStorage}</span>
                            <span className="stat-label">Total Storage</span>
                          </div>
                          <div className="stat-divider"></div>

                          {/* File Explorer removed from here to avoid showing in main dashboard */}
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
                                  for (
                                    let i = 0;
                                    i < e.dataTransfer.items.length;
                                    i++
                                  ) {
                                    const item = e.dataTransfer.items[i];
                                    if (item.kind === "file") {
                                      const entry = item.webkitGetAsEntry
                                        ? item.webkitGetAsEntry()
                                        : null;

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
                                    const processedFiles = await traverseFileTree(
                                      entries
                                    );
                                    fileList.push(...processedFiles);
                                  }

                                  console.log(
                                    `Found ${fileList.length} files to upload`
                                  );

                                  if (fileList.length > 0) {
                                    handleFileUpload(fileList);
                                  } else {
                                    setIsUploading(false);
                                  }
                                } catch (error) {
                                  console.error(
                                    "Error processing dropped items:",
                                    error
                                  );
                                  setIsUploading(false);
                                }
                              }
                            }}
                          >
                            <div className="upload-icon"></div>
                            <div className="dropzone-text">
                              <h4>Drag & drop files or folders here</h4>
                              <p>
                                Upload CCPA data to generate insights for your
                                Digital DNA
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <input
                    type="file"
                    id="file-upload-input"
                    multiple
                    {...({ webkitdirectory: "true", directory: "" } as any)}
                    style={{ display: "none" }}
                    onChange={(e) => {
                      if (e.target.files?.length) {
                        const fileList = Array.from(e.target.files);

                        // Process files and flatten folder structure
                        const processedFiles = fileList.map((file) => {
                          // For input[webkitdirectory], files have a webkitRelativePath property
                          const relativePath = (file as any).webkitRelativePath;

                          if (relativePath) {
                            // Get all directory parts except the filename
                            const pathParts = relativePath.split("/");
                            const fileName = pathParts.pop(); // Remove filename

                            if (pathParts.length > 0) {
                              // Create flattened filename with directory structure using dot delimiter
                              const flatName = pathParts.join(".") + "." + fileName;

                              // Create new file with flattened name
                              return new File([file], flatName, {
                                type: file.type,
                                lastModified: file.lastModified,
                              });
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

                {/* Stage 2: Analyzed Data Section */}
                <div className="dashboard-section">
                  <div className="section-header">
                    <h3>
                      Analyzed Data (
                      {metrics?.categoryCounts || fileCategories.length})
                    </h3>
                  </div>

                  <div className="category-cards">
                    {fileCategories.map((category, index) => (
                      <div className="category-card" key={index}>
                        <CategoryIcon type={category.icon} />
                        <div className="category-info">
                          <h4>{category.name}</h4>
                          {(category.count !== null || category.size !== null) && (
                            <div className="category-meta">
                              {category.count !== null && (
                                <>
                                  <span>{category.count} files</span>
                                  {category.size !== null && (
                                    <span className="dot-separator">•</span>
                                  )}
                                </>
                              )}
                              {category.size !== null && (
                                <span>{category.size}</span>
                              )}
                            </div>
                          )}
                          <div className="category-updated">
                            Updated {category.lastUpdated}
                          </div>
                          <div className="category-summary">
                            {getCategorySummary(category.name.toLowerCase())}
                          </div>
                          <button
                            className="text-button view-details-link"
                            onClick={() =>
                              onNavigate(`category/${category.name.toLowerCase()}`)
                            }
                          >
                            View Details →
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Stage 3: Insights Section */}
                <div className="dashboard-section">
                  <div className="section-header">
                    <h3>Insights ({metrics?.personaCounts || personas.length})</h3>
                  </div>

                  <div className="persona-cards">
                    {personas.map((persona) => (
                      <div className="persona-card" key={persona.id}>
                        <div className="persona-header">
                          <h4>{persona.name}</h4>
                          <span className="persona-type">{persona.type}</span>
                        </div>

                        {/* Progress bar */}
                        <ProgressBar
                          percentage={persona.completeness}
                          type={persona.type}
                        />

                        {/* Summary (if available) */}
                        {persona.summary && (
                          <div className="persona-summary">
                            <p>{persona.summary}</p>
                          </div>
                        )}

                        {/* Insights (if available) */}
                        {persona.insights && persona.insights.length > 0 && (
                          <div className="persona-insights">
                            <h5>Key Insights:</h5>
                            <ul>
                              {persona.insights.slice(0, 3).map((insight, idx) => (
                                <li key={idx}>{insight}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Traits (if available) */}
                        {persona.traits &&
                          Object.keys(persona.traits).length > 0 && (
                            <div className="persona-traits">
                              <h5>Traits:</h5>
                              <div className="traits-list">
                                {Object.entries(persona.traits)
                                  .slice(0, 3)
                                  .map(([key, value]) => (
                                    <div className="trait-item" key={key}>
                                      <span className="trait-key">
                                        {key.charAt(0).toUpperCase() + key.slice(1)}
                                        :
                                      </span>
                                      <span className="trait-value">
                                        {Array.isArray(value)
                                          ? value.slice(0, 2).join(", ") +
                                            (value.length > 2 ? "..." : "")
                                          : typeof value === "object" &&
                                            value !== null
                                          ? Object.entries(value)
                                              .slice(0, 2)
                                              .map(([k, v]) => `${k}: ${v}`)
                                              .join(", ") +
                                            (Object.keys(value).length > 2
                                              ? "..."
                                              : "")
                                          : String(value)}
                                      </span>
                                    </div>
                                  ))}
                              </div>
                            </div>
                          )}

                        {/* Source data (if available) */}
                        {persona.sources && persona.sources.length > 0 && (
                          <div className="persona-sources">
                            <span>
                              Based on {persona.sources.length} source
                              {persona.sources.length !== 1 ? "s" : ""}
                            </span>
                          </div>
                        )}

                        <div className="persona-footer">
                          <span>Updated {persona.lastUpdated}</span>
                          <div className="persona-status">Auto-updating</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            
            {/* Right side: User Master Profile */}
            <div className="dashboard-sidebar">
              {userMasterProfile ? (
                <UserMasterProfileCard profile={userMasterProfile} />
              ) : (
                <div className="user-master-profile-card empty-profile">
                  <h3 className="profile-title">User Profile</h3>
                  <p className="empty-profile-message">
                    Your profile is being built as your data is processed.
                    Upload more data to enhance your profile.
                  </p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default Dashboard;
