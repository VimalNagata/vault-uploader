import AWS from "aws-sdk";
import AuthService from "./AuthService";

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
}

// File categorization will be implemented in the backend

export default new S3Service();