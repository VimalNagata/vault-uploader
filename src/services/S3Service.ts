import AWS from 'aws-sdk';

class S3Service {
  private s3!: AWS.S3; // Use the definite assignment assertion
  private bucketName: string | null = null;
  private region!: string; // Add definite assignment here too
  private accessKeyId: string | null = null;
  private secretAccessKey: string | null = null;

  constructor() {
    // Check if environment variables are loaded
    console.log('Environment variables loaded:', {
      region: process.env.REACT_APP_AWS_REGION || 'not set',
      accessKeyId: process.env.REACT_APP_AWS_ACCESS_KEY_ID ? 'set' : 'not set',
      secretKey: process.env.REACT_APP_AWS_SECRET_ACCESS_KEY ? 'set' : 'not set',
      bucketName: process.env.REACT_APP_S3_BUCKET_NAME || 'not set'
    });

    // Region is no longer used for endpoint configuration
    this.region = process.env.REACT_APP_AWS_REGION || 'us-east-1';
    
    // Get credentials directly from environment variables
    this.accessKeyId = process.env.REACT_APP_AWS_ACCESS_KEY_ID || null;
    this.secretAccessKey = process.env.REACT_APP_AWS_SECRET_ACCESS_KEY || null;
    
    // Log warning if credentials are missing
    if (!this.accessKeyId || !this.secretAccessKey) {
      console.warn('AWS credentials not found in environment variables');
    }
    
    // Get bucket name from environment
    this.bucketName = process.env.REACT_APP_S3_BUCKET_NAME || null;
    
    // Log warning if bucket name is missing
    if (!this.bucketName) {
      console.warn('S3 bucket name not found in environment variables');
    }
    
    // Initialize S3 client with environment variables
    this.initializeS3Client();
  }
  
  /**
   * Initialize the S3 client with current settings
   */
  private initializeS3Client() {
    // Make sure all required configuration is available
    if (!this.accessKeyId || !this.secretAccessKey) {
      console.error('Cannot initialize S3 client: Missing AWS credentials');
      return;
    }
    
    if (!this.bucketName) {
      console.error('Cannot initialize S3 client: Missing S3 bucket name');
      return;
    }
    
    // Create credentials from environment variables
    const credentials = new AWS.Credentials({
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey
    });
    
    // Initialize S3 client with proper configuration
    const config: AWS.S3.ClientConfiguration = {
      credentials: credentials,
      s3ForcePathStyle: true // Use path style addressing for compatibility
    };
    
    console.log('Initializing S3 client with config:', {
      bucketName: this.bucketName,
      hasCredentials: true
    });
    
    this.s3 = new AWS.S3(config);
  }

  /**
   * Set the bucket name manually
   */
  setBucketName(bucketName: string) {
    this.bucketName = bucketName;
  }

  /**
   * Set the AWS region
   */
  setRegion(region: string) {
    this.region = region;
    this.initializeS3Client();
  }
  
  /**
   * Set AWS credentials manually
   */
  setCredentials(accessKeyId: string, secretAccessKey: string) {
    this.accessKeyId = accessKeyId;
    this.secretAccessKey = secretAccessKey;
    this.initializeS3Client();
  }

  /**
   * Get the current bucket name
   */
  getBucketName(): string | null {
    return this.bucketName;
  }
  
  /**
   * Get the current region
   */
  getRegion(): string {
    return this.region;
  }
  
  /**
   * Check if credentials are set
   */
  hasCredentials(): boolean {
    return !!(this.accessKeyId && this.secretAccessKey);
  }
  
  /**
   * Get access key ID (first few characters only for security)
   */
  getAccessKeyPreview(): string | null {
    if (!this.accessKeyId) return null;
    return this.accessKeyId.substring(0, 5) + '...';
  }

  /**
   * Upload a file to S3
   * @param file File to upload
   * @param path Path in the bucket (folder name)
   * @param customBucketName Optional bucket name to override the default
   * @returns Promise with upload result
   */
  async uploadFile(
    file: File, 
    path: string
  ): Promise<AWS.S3.ManagedUpload.SendData> {
    if (!this.bucketName) {
      throw new Error('S3 bucket name is not configured. Please set REACT_APP_S3_BUCKET_NAME in your .env file.');
    }
    
    if (!this.accessKeyId || !this.secretAccessKey) {
      throw new Error('AWS credentials are not configured. Please set REACT_APP_AWS_ACCESS_KEY_ID and REACT_APP_AWS_SECRET_ACCESS_KEY in your .env file.');
    }
    
    const key = `${path}/${file.name}`;
    
    const params: AWS.S3.PutObjectRequest = {
      Bucket: this.bucketName,
      Key: key,
      Body: file,
      ContentType: file.type
    };

    console.log(`Uploading file: ${file.name} to ${this.bucketName}/${key}`);
    return await this.s3.upload(params).promise();
  }

  /**
   * Upload multiple files in a folder structure
   * @param files Array of files to upload
   * @param basePath Base path in the bucket
   * @param relativePaths Relative paths for each file (from base)
   * @param customBucketName Optional bucket name to override the default
   * @returns Promise with all upload results
   */
  async uploadFolder(
    files: File[],
    basePath: string,
    relativePaths: string[],
    username: string = 'user'
  ): Promise<AWS.S3.ManagedUpload.SendData[]> {
    const uploadPromises = files.map((file, index) => {
      const fullPath = `${username}/vault/rawdata/${relativePaths[index] || ''}`;
      return this.uploadFile(file, fullPath);
    });

    return await Promise.all(uploadPromises);
  }

  /**
   * List files in the user's vault/rawdata folder
   * @param username Username whose files to list
   * @param prefix Optional subfolder path
   * @returns Promise with the list of files
   */
  async listUserFiles(
    username: string = 'user',
    prefix: string = ''
  ): Promise<AWS.S3.ObjectList> {
    if (!this.bucketName) {
      throw new Error('S3 bucket name is not configured. Please set REACT_APP_S3_BUCKET_NAME in your .env file.');
    }
    
    if (!this.accessKeyId || !this.secretAccessKey) {
      throw new Error('AWS credentials are not configured. Please set REACT_APP_AWS_ACCESS_KEY_ID and REACT_APP_AWS_SECRET_ACCESS_KEY in your .env file.');
    }
    
    const fullPrefix = prefix ? `${username}/vault/rawdata/${prefix}` : `${username}/vault/rawdata/`;
    
    const params: AWS.S3.ListObjectsV2Request = {
      Bucket: this.bucketName,
      Prefix: fullPrefix,
      MaxKeys: 1000
    };
    
    console.log(`Listing files in ${this.bucketName} with prefix ${fullPrefix}`);
    const response = await this.s3.listObjectsV2(params).promise();
    return response.Contents || [];
  }
}

export default new S3Service();