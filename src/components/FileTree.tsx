import React, { useState, useEffect } from 'react';
import './FileTree.css';
import S3Service from '../services/S3Service';

// TreeNode types
interface TreeFile {
  name: string;
  type: 'file';
  size: number;
  lastModified?: Date;
  key: string;
}

interface TreeFolder {
  name: string;
  type: 'folder';
  children: TreeNode[];
  size: number;
}

type TreeNode = TreeFile | TreeFolder;

interface FileTreeProps {
  data: TreeNode;
  onFileClick?: (file: TreeFile) => void;
  username?: string; // Optional username to load tree data if not provided
  onDataLoaded?: (data: TreeNode) => void; // Callback when tree data is loaded
}

// Utility function to format file sizes
const formatBytes = (bytes: number, decimals: number = 2): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
};

// Function to determine icon based on file extension
const getFileIcon = (fileName: string): string => {
  const extension = fileName.split('.').pop()?.toLowerCase() || '';
  
  // Common file types
  switch (extension) {
    case 'pdf':
      return '📄';
    case 'jpg':
    case 'jpeg':
    case 'png':
    case 'gif':
    case 'svg':
      return '🖼️';
    case 'doc':
    case 'docx':
      return '📝';
    case 'xls':
    case 'xlsx':
    case 'csv':
      return '📊';
    case 'ppt':
    case 'pptx':
      return '📑';
    case 'zip':
    case 'rar':
    case 'tar':
    case 'gz':
      return '📦';
    case 'mp3':
    case 'wav':
    case 'ogg':
      return '🎵';
    case 'mp4':
    case 'mov':
    case 'avi':
      return '🎬';
    case 'html':
    case 'htm':
      return '🌐';
    case 'js':
    case 'ts':
    case 'jsx':
    case 'tsx':
      return '📜';
    case 'json':
      return '📋';
    case 'txt':
      return '📃';
    default:
      return '📄';
  }
};

const TreeNodeComponent: React.FC<{
  node: TreeNode;
  level: number;
  onFileClick?: (file: TreeFile) => void;
}> = ({ node, level, onFileClick }) => {
  const [expanded, setExpanded] = useState(level < 1); // Auto-expand first level
  
  const handleToggle = () => {
    setExpanded(!expanded);
  };
  
  const indent = level * 16; // 16px per level
  
  if (node.type === 'folder') {
    return (
      <div className="tree-node">
        <div 
          className="folder-node" 
          style={{ paddingLeft: `${indent}px` }}
          onClick={handleToggle}
        >
          <span className="folder-icon">{expanded ? '📂' : '📁'}</span>
          <span className="node-name">{node.name}</span>
          <span className="node-info">{formatBytes(node.size)}</span>
        </div>
        
        {expanded && node.children.length > 0 && (
          <div className="folder-children">
            {node.children.map((child, index) => (
              <TreeNodeComponent 
                key={index} 
                node={child} 
                level={level + 1} 
                onFileClick={onFileClick}
              />
            ))}
          </div>
        )}
      </div>
    );
  } else {
    return (
      <div 
        className="tree-node"
        onClick={() => onFileClick && onFileClick(node)}
      >
        <div className="file-node" style={{ paddingLeft: `${indent}px` }}>
          <span className="file-icon">{getFileIcon(node.name)}</span>
          <span className="node-name">{node.name}</span>
          <span className="node-info">{formatBytes(node.size)}</span>
        </div>
      </div>
    );
  }
};

const FileTree: React.FC<FileTreeProps> = ({ data, onFileClick, username, onDataLoaded }) => {
  const [treeData, setTreeData] = useState<TreeNode>(data);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  
  // Load tree data if empty and username is provided
  useEffect(() => {
    const loadTreeData = async () => {
      // Only load data if we have an empty folder and a username
      if (username && (!data || (data.type === 'folder' && data.children.length === 0))) {
        try {
          setIsLoading(true);
          
          // Load data with file tree specifically enabled
          const userData = await S3Service.getUserDataMetrics(
            username,
            undefined, // Use default stage
            true,      // includeAllStages
            false,     // Don't use summary only
            undefined, // No stage filter
            false      // Include file tree
          );
          
          if (userData.fileTree) {
            setTreeData(userData.fileTree);
            // Notify parent component if callback provided
            if (onDataLoaded) {
              onDataLoaded(userData.fileTree);
            }
          }
        } catch (error) {
          console.error("Error loading file tree data:", error);
        } finally {
          setIsLoading(false);
        }
      }
    };
    
    loadTreeData();
  }, [username, data, onDataLoaded]);

  // Show loading state
  if (isLoading) {
    return (
      <div className="file-tree-empty">
        <p>Loading file tree...</p>
      </div>
    );
  }
  
  // Show empty state
  if (!treeData || (treeData.type === 'folder' && treeData.children.length === 0)) {
    return (
      <div className="file-tree-empty">
        <p>No files found</p>
      </div>
    );
  }

  return (
    <div className="file-tree-container">
      <div className="file-tree-header">
        <span className="header-name">Name</span>
        <span className="header-size">Size</span>
      </div>
      <div className="file-tree">
        {treeData.type === 'folder' ? (
          treeData.children.map((child, index) => (
            <TreeNodeComponent 
              key={index} 
              node={child} 
              level={0} 
              onFileClick={onFileClick}
            />
          ))
        ) : (
          <TreeNodeComponent node={data} level={0} onFileClick={onFileClick} />
        )}
      </div>
    </div>
  );
};

export default FileTree;