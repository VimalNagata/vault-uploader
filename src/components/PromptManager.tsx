import React, { useState, useEffect } from 'react';
import './PromptManager.css';
import S3Service from '../services/S3Service';

interface PromptTemplate {
  [key: string]: string;
}

interface PromptManagerProps {
  userEmail: string;
}

const ADMIN_EMAILS = ["patavardhan@gmail.com", "sharadnyc@gmail.com"];

const PromptManager: React.FC<PromptManagerProps> = ({ userEmail }) => {
  const [isAdmin, setIsAdmin] = useState(false);
  const [prompts, setPrompts] = useState<PromptTemplate>({});
  const [selectedPrompt, setSelectedPrompt] = useState<string>('');
  const [editedPrompt, setEditedPrompt] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');

  // Check if the current user is an admin
  useEffect(() => {
    setIsAdmin(ADMIN_EMAILS.includes(userEmail));
  }, [userEmail]);

  // Fetch prompts when component mounts
  useEffect(() => {
    if (isAdmin) {
      fetchPrompts();
    }
  }, [isAdmin]);

  // Fetch prompts from Lambda function
  const fetchPrompts = async () => {
    setLoading(true);
    setError('');
    
    try {
      // Call the prompt-manager Lambda through API Gateway
      const response = await S3Service.callApi('GET', 'prompt-manager');
      if (response && response.prompts) {
        setPrompts(response.prompts);
        
        // Select the first prompt by default
        const promptNames = Object.keys(response.prompts);
        if (promptNames.length > 0) {
          setSelectedPrompt(promptNames[0]);
          setEditedPrompt(response.prompts[promptNames[0]]);
        }
      } else {
        setError('No prompts found or invalid response format');
      }
    } catch (err) {
      console.error('Error fetching prompts:', err);
      setError('Failed to fetch prompts. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Update prompt in Lambda function
  const updatePrompt = async () => {
    if (!selectedPrompt || !editedPrompt) {
      setError('No prompt selected or prompt is empty');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');
    
    try {
      // Call the prompt-manager Lambda through API Gateway
      await S3Service.callApi('PUT', 'prompt-manager', {
        name: selectedPrompt,
        template: editedPrompt
      });
      
      // Update local state
      setPrompts(prev => ({
        ...prev,
        [selectedPrompt]: editedPrompt
      }));
      
      setSuccess(`Prompt "${selectedPrompt}" updated successfully`);
    } catch (err) {
      console.error('Error updating prompt:', err);
      setError('Failed to update prompt. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Handle prompt selection
  const handlePromptSelect = (promptName: string) => {
    setSelectedPrompt(promptName);
    setEditedPrompt(prompts[promptName]);
  };

  if (!isAdmin) {
    return (
      <div className="prompt-manager">
        <h2>Prompt Manager</h2>
        <p>You do not have permission to access this feature.</p>
      </div>
    );
  }

  return (
    <div className="prompt-manager">
      <h2>Prompt Manager</h2>
      <p className="description">
        Manage AI prompt templates used by the system. Changes will affect how AI processes data in future uploads.
      </p>
      
      {loading && <div className="loading">Loading prompts...</div>}
      
      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}
      
      {!loading && (
        <div className="prompt-editor">
          <div className="prompt-selector">
            <label htmlFor="prompt-select">Select Prompt:</label>
            <select 
              id="prompt-select" 
              value={selectedPrompt} 
              onChange={(e) => handlePromptSelect(e.target.value)}
            >
              {Object.keys(prompts).map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>
          
          <div className="prompt-content">
            <label htmlFor="prompt-textarea">Edit Prompt Template:</label>
            <textarea 
              id="prompt-textarea" 
              value={editedPrompt} 
              onChange={(e) => setEditedPrompt(e.target.value)}
              rows={20}
            />
          </div>
          
          <div className="template-variables">
            <h3>Available Template Variables</h3>
            <p>Use these variables in your prompt templates:</p>
            <ul>
              {selectedPrompt === 'categorize-user-data' && (
                <>
                  <li><code>{`{{fileName}}`}</code> - Name of the file being processed</li>
                  <li><code>{`{{userContext}}`}</code> - User's existing profile data</li>
                  <li><code>{`{{content}}`}</code> - Content of the file being analyzed</li>
                </>
              )}
              {selectedPrompt === 'persona-builder' && (
                <>
                  <li><code>{`{{personaType}}`}</code> - Type of persona (financial, social, etc.)</li>
                  <li><code>{`{{existingPersona}}`}</code> - Current persona data</li>
                  <li><code>{`{{fileName}}`}</code> - Name of the file being processed</li>
                  <li><code>{`{{fileType}}`}</code> - Type of file (e.g., facebook, google)</li>
                  <li><code>{`{{fileSummary}}`}</code> - Summary of the file content</li>
                  <li><code>{`{{relevance}}`}</code> - Relevance score for this persona type</li>
                  <li><code>{`{{categorySummary}}`}</code> - Summary for this category</li>
                  <li><code>{`{{dataPoints}}`}</code> - Key data points for this category</li>
                  <li><code>{`{{userProfile}}`}</code> - User master profile information</li>
                  <li><code>{`{{completeness}}`}</code> - Current completeness score</li>
                  <li><code>{`{{timestamp}}`}</code> - Current timestamp</li>
                </>
              )}
            </ul>
          </div>
          
          <div className="prompt-actions">
            <button onClick={updatePrompt} disabled={loading}>
              Save Changes
            </button>
            <button onClick={fetchPrompts} disabled={loading}>
              Reset to Saved
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PromptManager;