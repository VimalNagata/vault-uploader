/**
 * Mock S3Service for GitHub Pages deployment
 * This service simulates S3 behavior without actually connecting to AWS
 */
class MockS3Service {
  private bucketName: string = 'demo-bucket';
  private region: string = 'demo-region';
  private accessKeyId: string = 'GITHUB_PAGES_DEMO';
  private secretAccessKey: string = 'GITHUB_PAGES_DEMO_SECRET';
  private mockFiles: Record<string, any[]> = {};

  constructor() {
    // Initialize with some mock data
    this.mockFiles = {
      'user/vault/rawdata/': [
        { 
          Key: 'user/vault/rawdata/example.txt',
          LastModified: new Date(),
          Size: 1024,
          ETag: '12345'
        },
        { 
          Key: 'user/vault/rawdata/demo/file.pdf',
          LastModified: new Date(),
          Size: 20480,
          ETag: '67890'
        },
        { 
          Key: 'user/vault/rawdata/emails/emails.json',
          LastModified: new Date(),
          Size: 5120,
          ETag: 'abcde'
        }
      ]
    };
    
    console.log('Mock S3 Service initialized for GitHub Pages demo');
  }

  // Getters
  getBucketName(): string | null {
    return this.bucketName;
  }
  
  getRegion(): string {
    return this.region;
  }
  
  hasCredentials(): boolean {
    return true;
  }
  
  getAccessKeyPreview(): string | null {
    return 'DEMO_...';
  }

  // Setters
  setBucketName(bucketName: string) {
    this.bucketName = bucketName;
  }
  
  setRegion(region: string) {
    this.region = region;
  }
  
  setCredentials(accessKeyId: string, secretAccessKey: string) {
    this.accessKeyId = accessKeyId;
    this.secretAccessKey = secretAccessKey;
  }

  // Mock S3 operations
  async uploadFile(
    file: File, 
    path: string
  ): Promise<any> {
    console.log(`[DEMO MODE] Would upload ${file.name} to ${path}`);
    
    // Create mock response
    return {
      Location: `https://demo.s3.amazonaws.com/${path}/${file.name}`,
      Key: `${path}/${file.name}`,
      Bucket: this.bucketName
    };
  }

  async uploadFolder(
    files: File[],
    basePath: string,
    relativePaths: string[],
    username: string = 'user'
  ): Promise<any[]> {
    console.log(`[DEMO MODE] Would upload ${files.length} files to ${username}/vault/rawdata/`);
    
    // Add mock files to our storage
    const uploadPromises = files.map((file, index) => {
      const path = `${username}/vault/rawdata/${relativePaths[index] || ''}`;
      const key = `${path}/${file.name}`;
      
      // Add to our mock files store
      if (!this.mockFiles[`${username}/vault/rawdata/`]) {
        this.mockFiles[`${username}/vault/rawdata/`] = [];
      }
      
      this.mockFiles[`${username}/vault/rawdata/`].push({
        Key: key,
        LastModified: new Date(),
        Size: file.size,
        ETag: Math.random().toString(36).substring(2, 8)
      });
      
      return this.uploadFile(file, path);
    });

    return await Promise.all(uploadPromises);
  }

  async listUserFiles(
    username: string = 'user',
    prefix: string = ''
  ): Promise<any[]> {
    console.log(`[DEMO MODE] Listing files for ${username}`);
    
    // Return our mock files
    const fullPrefix = prefix ? `${username}/vault/rawdata/${prefix}` : `${username}/vault/rawdata/`;
    const mockFiles = this.mockFiles[`${username}/vault/rawdata/`] || [];
    
    // Filter by prefix
    return mockFiles.filter(file => {
      return file.Key && file.Key.startsWith(fullPrefix);
    });
  }
}

export default new MockS3Service();