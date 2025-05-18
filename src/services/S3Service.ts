import AWS from "aws-sdk";
import AuthService from "./AuthService";

/**
 * Interface for file categorization response
 */
export interface CategorizedData {
  fileName: string;
  fileType: string;
  summary: string;
  categories: {
    [key: string]: {
      relevance: number;
      summary: string;
      dataPoints: string[];
    }
  };
  entityNames?: string[];
  insights?: string[];
  sensitiveInfo: boolean;
}

class S3Service {
  private s3: AWS.S3 | null = null;
  private bucketName: string | null = null;
  private region: string = "us-east-1";
  private isInitialized: boolean = false;
  private credentialsExpiry: Date | null = null;

  constructor() {
    // For non-production environments, we'll still try to get values from env
    if (process.env.NODE_ENV !== "production") {
      this.region = process.env.REACT_APP_AWS_REGION || "us-east-1";
      this.bucketName = process.env.REACT_APP_S3_BUCKET_NAME || null;
    }

    console.log("S3Service initialized in mode:", process.env.NODE_ENV);
  }

  /**
   * Initialize the S3 client with credentials from AuthService
   */
  private async ensureInitialized(): Promise<void> {
    // If already initialized and we have an S3 client, we're good
    if (this.isInitialized && this.s3 && this.credentialsExpiry) {
      // But check if credentials are about to expire
      const now = new Date();
      const bufferMs = 5 * 60 * 1000; // 5 minutes
      
      if (now.getTime() + bufferMs < this.credentialsExpiry.getTime()) {
        // Credentials are still valid
        return;
      } else {
        console.log("AWS credentials are about to expire, refreshing...");
      }
    }

    try {
      // Get credentials from AuthService (which calls Lambda)
      console.log("Fetching AWS credentials from AuthService...");
      const credentialsData = await AuthService.getAWSCredentials();
      console.log("Received credentials with expiration:", credentialsData.credentials.expiration);

      // Set our bucket name and region from the response
      this.bucketName = credentialsData.bucketName;
      this.region = credentialsData.region;
      this.credentialsExpiry = new Date(credentialsData.credentials.expiration);

      console.log("Using S3 bucket:", this.bucketName);
      console.log("Using AWS region:", this.region);

      // Create AWS credentials object
      const credentials = new AWS.Credentials({
        accessKeyId: credentialsData.credentials.accessKeyId,
        secretAccessKey: credentialsData.credentials.secretAccessKey,
        sessionToken: credentialsData.credentials.sessionToken,
      });

      // Debug credentials format (only show part of access key)
      console.log("AWS Credentials:", {
        accessKeyId: `${credentialsData.credentials.accessKeyId.substring(0, 5)}...`,
        accessKeyLength: credentialsData.credentials.accessKeyId.length,
        secretKeyLength: credentialsData.credentials.secretAccessKey.length,
        sessionTokenLength: credentialsData.credentials.sessionToken.length,
        expiration: credentialsData.credentials.expiration
      });

      // Initialize S3 client with credentials
      const config: AWS.S3.ClientConfiguration = {
        credentials: credentials,
        region: this.region,
        s3ForcePathStyle: true, // Use path style addressing for compatibility
        signatureVersion: 'v4', // Explicitly use signature version 4
        maxRetries: 3, // Retry failed requests
        httpOptions: {
          timeout: 60000 // Increase timeout to 60 seconds
        },
        // This will help minimize clock skew issues
        correctClockSkew: true
      };

      console.log("Initializing S3 client with config:", JSON.stringify({
        region: this.region,
        s3ForcePathStyle: true,
        signatureVersion: 'v4',
        maxRetries: 3,
        timeout: 60000,
        correctClockSkew: true
      }));

      // Set AWS SDK to use secure/updated values
      AWS.config.update({
        region: this.region,
        signatureVersion: 'v4',
        correctClockSkew: true
      });
      
      // Initialize the S3 client
      this.s3 = new AWS.S3(config);
      this.isInitialized = true;
    } catch (error) {
      console.error("Failed to initialize S3 client:", error);
      this.isInitialized = false;
      this.s3 = null;
      this.credentialsExpiry = null;
      throw error;
    }
  }

  /**
   * Get the current bucket name
   */
  async getBucketName(): Promise<string | null> {
    await this.ensureInitialized();
    return this.bucketName;
  }

  /**
   * Get the current region
   */
  async getRegion(): Promise<string> {
    await this.ensureInitialized();
    return this.region;
  }

  /**
   * Check if service is initialized with credentials
   */
  isReady(): boolean {
    return this.isInitialized && !!this.s3;
  }

  /**
   * Force refresh of credentials
   */
  async refreshCredentials(): Promise<void> {
    this.isInitialized = false;
    this.s3 = null;
    this.credentialsExpiry = null;
    await this.ensureInitialized();
  }

  /**
   * Upload a file to S3
   * @param file File to upload
   * @param path Path in the bucket (folder name)
   * @returns Promise with upload result
   */
  async uploadFile(
    file: File,
    path: string
  ): Promise<AWS.S3.ManagedUpload.SendData> {
    await this.ensureInitialized();

    if (!this.bucketName || !this.s3) {
      throw new Error("S3 service is not properly initialized");
    }

    // Normalize path to remove any ./ or trailing slashes and handle special characters
    let normalizedPath = path;
    
    // Remove ./ and /.
    normalizedPath = normalizedPath.replace(/\.\/|\/\./g, '');
    
    // Remove any double slashes
    normalizedPath = normalizedPath.replace(/\/+/g, '/');
    
    // Remove leading and trailing slashes
    normalizedPath = normalizedPath.replace(/^\/+|\/+$/g, '');
    
    console.log(`Original path: "${path}", Normalized path: "${normalizedPath}"`);
    
    // Create a clean key without double slashes
    const key = normalizedPath ? `${normalizedPath}/${file.name}` : file.name;

    const params: AWS.S3.PutObjectRequest = {
      Bucket: this.bucketName,
      Key: key,
      Body: file,
      ContentType: file.type,
    };

    console.log(`Uploading file: ${file.name} to ${this.bucketName}/${key}`);
    console.log(`Full S3 Path: s3://${this.bucketName}/${key}`);
    
    // Check for mock credentials and simulate success
    // This allows development/testing without real AWS credentials
    const credentials = await AuthService.getAWSCredentials();
    if (credentials.credentials.accessKeyId === 'MOCK_ACCESS_KEY_FOR_TESTING') {
      console.log("Using mock credentials - simulating successful upload");
      
      // Return a simulated upload result
      return {
        Location: `https://${this.bucketName}.s3.amazonaws.com/${key}`,
        ETag: '"mocketagfortesting"',
        Bucket: this.bucketName,
        Key: key
      } as AWS.S3.ManagedUpload.SendData;
    }

    // Log the credentials we're using (never log the full secret key)
    console.log('Using credentials:', {
      accessKeyId: `${credentials.credentials.accessKeyId.substring(0, 5)}...`,
      accessKeyIdLength: credentials.credentials.accessKeyId.length,
      secretKeyLength: credentials.credentials.secretAccessKey.length,
      sessionTokenLength: credentials.credentials.sessionToken?.length || 0,
      expiration: credentials.credentials.expiration
    });
    
    // Debug the S3 client configuration
    console.log('S3 Client Config:', {
      region: this.region,
      bucketName: this.bucketName,
      s3ForcePathStyle: true,
      signatureVersion: (this.s3 as any)?.config?.signatureVersion || 'unknown',
      useAccelerateEndpoint: (this.s3 as any)?.config?.useAccelerateEndpoint || false,
      sslEnabled: (this.s3 as any)?.config?.sslEnabled !== false,
      maxRetries: (this.s3 as any)?.config?.maxRetries || 0
    });
    
    try {
      // Enable detailed signing/request debugging for this operation
      const originalLogger = AWS.config.logger;
      AWS.config.logger = console;
      
      // Test bucket access first with a simple headBucket operation
      console.log(`Testing bucket access to ${this.bucketName}...`);
      try {
        await this.s3.headBucket({ Bucket: this.bucketName }).promise();
        console.log("Bucket access test successful ✅");
      } catch (headError: any) {
        console.error("Bucket access test failed ❌:", headError.code, headError.message);
        if (headError.code === 'SignatureDoesNotMatch') {
          console.error("SIGNATURE MISMATCH DETAILS:", {
            requestId: headError.requestId,
            region: headError.region,
            hostname: headError.hostname,
            time: headError.time
          });
          console.log("Trying to refresh credentials before upload...");
          await this.refreshCredentials();
        }
      }
      
      // Attempt the upload
      console.log("Starting S3 upload with params:", {
        Bucket: params.Bucket,
        Key: params.Key,
        ContentLength: file.size,
        ContentType: params.ContentType
      });
      
      const result = await this.s3.upload(params).promise();
      console.log("Upload successful ✅:", {
        Location: result.Location,
        Bucket: result.Bucket,
        Key: result.Key,
        ETag: result.ETag
      });
      
      // Restore original logger
      AWS.config.logger = originalLogger;
      
      return result;
    } catch (error: unknown) {
      console.error("S3 upload failed ❌");
      
      // Type check the error for detailed logging
      if (typeof error === 'object' && error !== null) {
        const awsError = error as any;
        console.error("Error details:", {
          message: awsError.message,
          code: awsError.code,
          statusCode: awsError.statusCode,
          requestId: awsError.requestId,
          time: awsError.time?.toString(),
          region: awsError.region,
          hostname: awsError.hostname,
          retryable: awsError.retryable,
          retryCount: awsError.retryCount,
          service: awsError.service
        });
        
        if (awsError.code === 'SignatureDoesNotMatch') {
          console.error("SIGNATURE ERROR: The AWS SDK couldn't create a valid signature for the request.");
          console.error("This usually means:");
          console.error("1. The credentials are incorrectly formatted or expired");
          console.error("2. There's a clock skew between your browser and AWS");
          console.error("3. The policy in the credentials doesn't allow this operation");
          
          console.log("Attempting to refresh credentials and retry...");
          await this.refreshCredentials();
          
          console.log("Retrying upload with fresh credentials...");
          return await this.s3.upload(params).promise();
        } else if (awsError.code === 'InvalidAccessKeyId') {
          console.error("INVALID ACCESS KEY: The AWS access key doesn't exist or is incorrect");
          console.log("Attempting to refresh credentials and retry...");
          await this.refreshCredentials();
          
          console.log("Retrying upload with fresh credentials...");
          return await this.s3.upload(params).promise();
        } else if (awsError.code === 'AccessDenied') {
          console.error("ACCESS DENIED: The policy doesn't allow this operation or resource");
          console.error(`Tried to access: s3://${params.Bucket}/${params.Key}`);
        }
      }
      
      throw error;
    }
  }

  /**
   * Upload multiple files in a folder structure
   * @param files Array of files to upload
   * @param s3Prefix User's S3 prefix (from credentials)
   * @param relativePaths Relative paths for each file
   * @returns Promise with all upload results
   */
  async uploadFolder(
    files: File[],
    s3Prefix: string, // This should be sanitizedEmail from Lambda response
    relativePaths: string[]
  ): Promise<AWS.S3.ManagedUpload.SendData[]> {
    await this.ensureInitialized();

    if (!this.bucketName || !this.s3) {
      throw new Error("S3 service is not properly initialized");
    }
    
    console.log(`Starting upload of ${files.length} files to prefix: ${s3Prefix}`);
    
    // Test the S3 connection first
    try {
      // List objects to test permissions
      const testParams = {
        Bucket: this.bucketName,
        Prefix: s3Prefix,
        MaxKeys: 1
      };
      
      console.log("Testing S3 list operation before upload...");
      await this.s3.listObjectsV2(testParams).promise();
      console.log("S3 list test successful");
    } catch (error: unknown) {
      console.error("S3 list test failed - possible permissions issue:", error);
      
      // Type-check the error properly
      if (typeof error === 'object' && error !== null && 'code' in error) {
        const awsError = error as { code: string };
        // If it's a credentials issue, try refreshing
        if (awsError.code === 'SignatureDoesNotMatch' || awsError.code === 'InvalidAccessKeyId') {
          console.log("Credential error detected, refreshing credentials");
          await this.refreshCredentials();
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }

    console.log(`Starting batch upload of ${files.length} files to prefix: ${s3Prefix}`);
    
    // Process files in smaller batches to avoid overwhelming the browser
    // and to provide more granular progress feedback
    const batchSize = 3;
    const results: AWS.S3.ManagedUpload.SendData[] = [];
    
    for (let i = 0; i < files.length; i += batchSize) {
      const batchFiles = files.slice(i, i + batchSize);
      const batchPaths = relativePaths.slice(i, i + batchSize);
      
      console.log(`Processing batch ${Math.floor(i/batchSize) + 1} of ${Math.ceil(files.length/batchSize)}: ${batchFiles.map(f => f.name).join(', ')}`);
      
      // Process this batch in parallel
      const batchPromises = batchFiles.map((file, batchIndex) => {
        // Get and normalize the relative path
        let relativePath = batchPaths[batchIndex] || "";
        relativePath = relativePath.replace(/\.\/|\/\./g, '').replace(/\/+$/, '');
        
        // Construct the S3 key correctly based on policy
        // Normalize the path to avoid issues with ./ and // in the path
        const fullPath = relativePath 
          ? `${s3Prefix}/${relativePath}`.replace(/\/+/g, '/').replace(/\/+$/, "") 
          : s3Prefix;
        
        console.log(`File: ${file.name}, RelativePath: "${relativePath}", FullPath: "${fullPath}"`);
        return this.uploadFile(file, fullPath);
      });
      
      // Wait for this batch to complete before moving to the next
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      console.log(`Completed batch ${Math.floor(i/batchSize) + 1}: ${batchResults.length} files uploaded`);
    }

    console.log(`All uploads completed: ${results.length} files uploaded successfully`);
    return results;
  }

  /**
   * List files in a user's prefix
   * @param s3Prefix User's S3 prefix from credentials
   * @param path Optional additional path
   * @returns Promise with the list of files
   */
  async listFiles(
    s3Prefix: string,
    path: string = ""
  ): Promise<AWS.S3.ObjectList> {
    await this.ensureInitialized();

    if (!this.bucketName || !this.s3) {
      throw new Error("S3 service is not properly initialized");
    }

    const fullPrefix = path
      ? `${s3Prefix}/${path}`
      : s3Prefix;

    // Check for mock credentials and return mock data
    const credentials = await AuthService.getAWSCredentials();
    if (credentials.credentials.accessKeyId === 'MOCK_ACCESS_KEY_FOR_TESTING') {
      console.log("Using mock credentials - simulating listFiles response");
      
      // Return simulated files for the requested prefix
      const mockFiles = [
        {
          Key: `${fullPrefix}/example1.pdf`,
          LastModified: new Date(),
          Size: 1024,
          ETag: '"mocktag1"',
          StorageClass: 'STANDARD'
        },
        {
          Key: `${fullPrefix}/example2.jpg`,
          LastModified: new Date(Date.now() - 86400000), // yesterday
          Size: 2048,
          ETag: '"mocktag2"',
          StorageClass: 'STANDARD'
        },
        {
          Key: `${fullPrefix}/subfolder/example3.txt`,
          LastModified: new Date(Date.now() - 172800000), // 2 days ago
          Size: 512,
          ETag: '"mocktag3"',
          StorageClass: 'STANDARD'
        }
      ] as AWS.S3.Object[];
      
      return mockFiles;
    }

    const params: AWS.S3.ListObjectsV2Request = {
      Bucket: this.bucketName,
      Prefix: fullPrefix,
      MaxKeys: 1000,
    };

    console.log(
      `Listing files in ${this.bucketName} with prefix ${fullPrefix}`
    );
    const response = await this.s3.listObjectsV2(params).promise();
    return response.Contents || [];
  }
  
  /**
   * Get user data metrics and file tree from the Lambda function
   * @param username User's sanitized email/prefix
   * @param stage The data stage to get metrics for
   * @returns Promise with metrics and file tree
   */
  /**
   * Categorize a specific file using the Lambda function
   * @param username User's email or identifier
   * @param filePath Path to the file in S3 (full path including user prefix and stage)
   * @param fileName Name of the file to categorize
   * @returns Promise with the categorization result
   */
  async categorizeFile(username: string, filePath: string, fileName: string): Promise<any> {
    // Get JWT token for authorization
    const token = await AuthService.getJwtToken();
    
    if (!token) {
      throw new Error("Authentication required. Please sign in to categorize your data.");
    }
    
    // API endpoint for categorization
    const apiUrl = process.env.REACT_APP_CATEGORIZE_API_URL || 
      'https://8dk906qbg3.execute-api.us-east-1.amazonaws.com/prod/categorize';
    
    console.log(`Requesting categorization for file: ${fileName} at path: ${filePath}`);
    
    // Make API call to the Lambda function
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        filePath,
        fileName
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Error triggering categorization:', errorText);
      throw new Error(`Failed to categorize file: ${response.status} ${response.statusText}`);
    }
    
    return await response.json();
  }

  /**
   * Get user data metrics with optimized parameters
   * @param username User's email/identifier
   * @param stage The data stage to request 
   * @param includeAllStages Whether to include data from all stages
   * @param summaryOnly Whether to return only summary data (no file details)
   * @param stageFilter Optional filter to only return files from a specific stage
   * @param skipFileTree Whether to skip the file tree structure to reduce payload size
   * @returns Promise with metrics and file data
   */
  /**
   * Get files for a specific stage
   * @param username User's email/identifier
   * @param stage The stage to get files for
   * @returns Promise with the list of files for the specified stage
   */
  async getFilesByStage(
    username: string,
    stage: DataStage
  ): Promise<any[]> {
    // Call the metrics API with specific settings:
    // - Only get data for the specific stage
    // - Don't include all stages
    // - Don't use summary mode (we need the files)
    // - Apply stage filter to match our stage
    // - Skip the file tree (don't need it)
    const result = await this.getUserDataMetrics(
      username,
      stage,
      false,  // Don't include all stages
      false,  // Don't use summary mode
      stage,  // Filter to this stage
      true    // Skip file tree
    );
    
    // Return the files array or empty array if not available
    return result.files || [];
  }

  /**
   * Get user data metrics with optimized parameters
   * @param username User's email/identifier
   * @param stage The data stage to request 
   * @param includeAllStages Whether to include data from all stages
   * @param summaryOnly Whether to return only summary data (no file details)
   * @param stageFilter Optional filter to only return files from a specific stage
   * @param skipFileTree Whether to skip the file tree structure to reduce payload size
   * @returns Promise with metrics and file data
   */
  async getUserDataMetrics(
    username: string, 
    stage: DataStage = DataStage.YOUR_DATA,
    includeAllStages: boolean = false,
    summaryOnly: boolean = false,
    stageFilter?: DataStage,
    skipFileTree: boolean = false
  ): Promise<{
    metrics: {
      fileCount: number;
      totalSize: number;
      totalSizeFormatted: string;
      lastUpdated: string | null;
      stageMetrics?: {
        stage1: { fileCount: number; totalSize: number };
        stage2: { fileCount: number; totalSize: number };
        stage3: { fileCount: number; totalSize: number };
      }
    };
    fileTree: any;
    files: any[];
    categorized?: {
      files: Record<string, any>;
      categoryTypes: string[];
    };
    personas?: Record<string, any>;
  }> {
    // Get JWT token from AuthService
    const token = await AuthService.getJwtToken();
    
    if (!token) {
      console.error("No JWT token available - user is not authenticated");
      throw new Error("Authentication required. Please sign in to view your data.");
    }
    
    // Check token format - expecting a Google ID token or access token
    if (!token.match(/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_.+/=]*$/) && 
        !token.match(/^ya29\.[a-zA-Z0-9_-]+$/)) {
      console.error("JWT token format appears invalid (not a JWT or OAuth token)");  
    }
    
    // Get the API endpoint from environment variables or use a default
    // This is the URL of the API Gateway endpoint for the get-user-data-metrics Lambda
    // We need the full URL with /user-data-metrics path to match what was created in API Gateway
    const apiUrl = process.env.REACT_APP_METRICS_API_URL || 
      'https://8dk906qbg3.execute-api.us-east-1.amazonaws.com/prod/user-data-metrics';
    
    // Add query parameters to the URL
    // TEMPORARY: Add email parameter for now until authorization is fixed
    const userInfoStr = localStorage.getItem("dna_user_info");
    let email = "";
    
    if (userInfoStr) {
      try {
        const userInfo = JSON.parse(userInfoStr);
        email = userInfo.email || "";
        console.log("Using email from localStorage:", email);
      } catch (e) {
        console.error("Failed to parse user info:", e);
      }
    }
    
    // Build URL with parameters
    let url = `${apiUrl}?stage=${stage}${email ? `&email=${encodeURIComponent(email)}` : ''}${includeAllStages ? '&includeAllStages=true' : ''}`;
    
    // Add optimization parameters
    if (summaryOnly) {
      url += '&summaryOnly=true';
    }
    
    if (stageFilter) {
      url += `&stageFilter=${stageFilter}`;
    }
    
    if (skipFileTree) {
      url += '&skipFileTree=true';
    }
    
    console.log("Token being used for authorization:", token.substring(0, 20) + '...');
    
    console.log(`Fetching user data metrics from: ${url}`);
    
    // Make API call to the Lambda function
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Error fetching metrics:', errorText);
      console.error('HTTP Status:', response.status, response.statusText);
      console.error('Response headers:', Object.fromEntries([...response.headers.entries()]));
      
      // Try to parse the error if it's JSON
      try {
        const errorObj = JSON.parse(errorText);
        console.error('Parsed error details:', errorObj);
        
        // If the error mentions authentication/authorization, show more detailed message
        if (errorObj.message && errorObj.message.includes('authenticated')) {
          throw new Error(`Authentication error: ${errorObj.message}. Please log out and log in again.`);
        }
      } catch (parseError) {
        // Continue with generic error if JSON parsing fails
      }
      
      throw new Error(`Failed to fetch user data metrics: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Check if the response has the expected format
    if (!data.metrics) {
      console.error('Invalid response format:', data);
      throw new Error('Invalid response format from metrics endpoint');
    }
    
    // If we skipped the file tree, it won't be in the response
    if (!skipFileTree && !data.fileTree) {
      console.error('Missing file tree in response when requested:', data);
      throw new Error('Invalid response format from metrics endpoint');
    }
    
    // For development/testing, log the response
    console.log('Received metrics data:', {
      fileCount: data.metrics.fileCount,
      totalSize: data.metrics.totalSizeFormatted,
      lastUpdated: data.metrics.lastUpdated,
      treeDepth: data.fileTree.children?.length || 0
    });
    
    return data;
  }
}

// Folder structure for organizing user data
export enum DataStage {
  YOUR_DATA = "stage1",       // Raw uploaded data
  PREPROCESSED = "preprocessed", // Preprocessed data (PDF conversion, chunking)
  ANALYZED_DATA = "stage2",   // Analyzed/categorized data
  INSIGHTS = "stage3"         // Insights and personas
}

/**
 * Category types for data classification
 */
export enum DataCategory {
  FINANCIAL = "financial",
  SOCIAL = "social",
  PROFESSIONAL = "professional",
  ENTERTAINMENT = "entertainment"
}

/**
 * Get the full S3 path for a user's data at a specific stage
 * @param username The user's sanitized email/username
 * @param stage The data stage
 * @param subPath Optional sub-path within the stage
 * @returns The full S3 path
 */
export function getUserStagePath(username: string, stage: DataStage, subPath?: string): string {
  const basePath = `${username}/${stage}`;
  if (subPath) {
    return `${basePath}/${subPath}`;
  }
  return basePath;
}

export default new S3Service();