import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';

// Conditionally import S3Service or MockS3Service based on environment
// eslint-disable-next-line import/first
const S3Service = process.env.NODE_ENV === 'production' 
  ? require('../services/MockS3Service').default
  : require('../services/S3Service').default;

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

  // Process dropped files and preserve folder structure
  const onDrop = useCallback((acceptedFiles: File[]) => {
    setFiles(acceptedFiles);
    
    // Extract relative paths from FileSystemEntry if available
    const paths: string[] = [];
    
    acceptedFiles.forEach((file: any) => {
      // Get path from webkitRelativePath (when using input directory) or custom path
      let path = '';
      if (file.webkitRelativePath) {
        // Remove the file name from the path
        path = file.webkitRelativePath.split('/').slice(0, -1).join('/');
      } else if (file.path) {
        // For non-standard path property (some browsers/libraries)
        path = file.path.split('/').slice(0, -1).join('/');
      }
      
      paths.push(path);
    });
    
    setRelativePaths(paths);
    setError(null);
    setUploadComplete(false);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop,
    // Allow directory dropping
    noClick: false,
    noKeyboard: false,
    noDrag: false
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
      
      // Process files in batches to show progress
      const batchSize = 5;
      const totalFiles = files.length;
      let processed = 0;
      
      for (let i = 0; i < totalFiles; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        const batchPaths = relativePaths.slice(i, i + batchSize);
        
        await S3Service.uploadFolder(batch, '', batchPaths, username);
        
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
        <p>Drag & drop a folder here, or click to select a folder</p>
      </div>
      
      {files.length > 0 && (
        <div className="file-list">
          <h3>Selected Files: {files.length}</h3>
          <ul>
            {files.slice(0, 5).map((file, index) => (
              <li key={index}>
                {relativePaths[index] ? `${relativePaths[index]}/` : ''}{file.name} - {(file.size / 1024).toFixed(2)} KB
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