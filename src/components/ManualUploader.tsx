import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import S3Service, { DataStage, getUserStagePath } from '../services/S3Service';

interface ManualUploaderProps {
  username: string;
  onUploadComplete: () => void;
}

const ManualUploader: React.FC<ManualUploaderProps> = ({ username, onUploadComplete }) => {
  const [files, setFiles] = useState<File[]>([]);
  const [relativePaths, setRelativePaths] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadComplete, setUploadComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Process dropped files and flatten folder structure
  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    try {
      // Process and flatten any folders in the drop
      const processedFiles = await processFoldersAndFiles(acceptedFiles);
      setFiles(processedFiles);
      
      // No need for relative paths anymore since we flatten the structure
      setRelativePaths(processedFiles.map(() => ''));
      setError(null);
      setUploadComplete(false);
    } catch (error) {
      console.error("Error processing dropped files:", error);
      setError("Failed to process dropped files. Please try again.");
    }
  }, []);
  
  // Function to process folders and flatten file structure
  const processFoldersAndFiles = async (acceptedFiles: File[]): Promise<File[]> => {
    const processedFiles: File[] = [];
    
    for (const file of acceptedFiles) {
      const fileAny = file as any;
      
      // Check if this file has path information
      if (fileAny.webkitRelativePath || fileAny.path) {
        // Get the path without the filename
        let path = '';
        if (fileAny.webkitRelativePath) {
          const pathParts = fileAny.webkitRelativePath.split('/');
          pathParts.pop(); // Remove filename
          path = pathParts.join('.');
        } else if (fileAny.path) {
          const pathParts = fileAny.path.split('/');
          pathParts.pop(); // Remove filename 
          path = pathParts.join('.');
        }
        
        // Only modify name if we have a path
        if (path) {
          // Create a flattened name with folder paths using dot delimiter
          const flatName = path + '.' + file.name;
          
          // Create a new File object with the flattened name
          const renamedFile = new File(
            [file], 
            flatName,
            { type: file.type, lastModified: file.lastModified }
          );
          
          processedFiles.push(renamedFile);
          console.log(`Added file: ${renamedFile.name} (original path: ${path}/${file.name})`);
        } else {
          // No path, just add the original file
          processedFiles.push(file);
        }
      } else {
        // Regular file without path info
        processedFiles.push(file);
      }
    }
    
    return processedFiles;
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop,
    // Allow directory dropping
    noClick: false,
    noKeyboard: false,
    noDrag: false,
    // Enable directory upload
    useFsAccessApi: false, // Disable FileSystem Access API to support directory uploads
    multiple: true
  });

  const handleUpload = async () => {
    if (files.length === 0) {
      setError('Please select files to upload');
      return;
    }
    
    if (!username.trim()) {
      setError('Please enter a username');
      return;
    }

    try {
      setIsUploading(true);
      setError(null);
      
      // Force refresh credentials before upload to avoid signature issues
      try {
        await S3Service.refreshCredentials();
        console.log("AWS credentials refreshed before upload");
      } catch (credError) {
        console.error("Failed to refresh credentials:", credError);
        throw new Error(`Authentication error: ${credError instanceof Error ? credError.message : 'Unknown error'}`);
      }
      
      // Get user info from local storage
      const userInfoStr = localStorage.getItem('dna_user_info');
      if (!userInfoStr) {
        throw new Error("User information not found. Please sign in again.");
      }
      
      let userInfo;
      try {
        userInfo = JSON.parse(userInfoStr);
      } catch (e) {
        console.error("Failed to parse user info:", e);
        throw new Error("Invalid user information. Please sign in again.");
      }
      
      const userFolder = userInfo.s3Prefix || username;
      console.log(`Using user folder for upload: ${userFolder}`);
      
      // Get your data stage path for this user
      const stagePath = getUserStagePath(userFolder, DataStage.YOUR_DATA);
      console.log(`Uploading files to stage path: ${stagePath}`);
      
      // Process files in batches to show progress
      const batchSize = 5;
      const totalFiles = files.length;
      let processed = 0;
      
      for (let i = 0; i < totalFiles; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        // No relative paths needed - filenames already include flattened paths
        const emptyPaths = batch.map(() => '');
        
        console.log(`Uploading batch ${Math.floor(i/batchSize) + 1} of ${Math.ceil(totalFiles/batchSize)}`);
        
        // Upload files to the stage1 folder with empty paths since we flattened the structure
        await S3Service.uploadFolder(batch, stagePath, emptyPaths);
        
        processed += batch.length;
        setUploadProgress(Math.floor((processed / totalFiles) * 100));
      }
      
      setUploadComplete(true);
      onUploadComplete();
    } catch (err) {
      console.error('Upload error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(`Upload failed: ${errorMessage}`);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="manual-uploader">
      <h2>Manual Upload to Vault</h2>
      
      <div {...getRootProps()} className={`dropzone ${isDragActive ? 'active' : ''}`}>
        <input {...getInputProps()} {...{ directory: "", webkitdirectory: "" } as any} />
        <p>Drag & drop folders or files here, or click to select</p>
        <small>Files inside folders will be uploaded with flattened paths using dots (example: folder.subfolder.file.txt)</small>
      </div>
      
      {files.length > 0 && (
        <div className="file-list">
          <h3>Selected Files: {files.length}</h3>
          <ul>
            {files.slice(0, 5).map((file, index) => (
              <li key={index}>
                {file.name} - {(file.size / 1024).toFixed(2)} KB
              </li>
            ))}
            {files.length > 5 && <li>...and {files.length - 5} more files</li>}
          </ul>
        </div>
      )}
      
      {error && <div className="error-message">{error}</div>}
      
      {isUploading ? (
        <div className="progress-container">
          <div className="progress-bar" style={{ width: `${uploadProgress}%` }}></div>
          <span>{uploadProgress}%</span>
        </div>
      ) : (
        <button 
          onClick={handleUpload} 
          disabled={files.length === 0 || !username.trim()}
          className="upload-button"
        >
          Upload to S3
        </button>
      )}
      
      {uploadComplete && (
        <div className="success-message">
          Upload complete! All files were successfully uploaded to S3.
        </div>
      )}
    </div>
  );
};

export default ManualUploader;