// Include AWS SDK
const AWS = require("aws-sdk");

// CORS headers for all responses
const corsHeaders = {
  "Access-Control-Allow-Origin": "*", // For production, change to your domain
  "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Credentials": "true",
};

/**
 * Lambda function to retrieve user data metrics and file structure
 *
 * This function:
 * 1. Verifies the user is authenticated (through API Gateway Authorizer)
 * 2. Lists all files in the user's S3 prefix
 * 3. Calculates metrics (file count, total size)
 * 4. Organizes files into a tree structure
 * 5. Returns the data to the client
 */
exports.handler = async (event) => {
  try {
    console.log("Event received:", JSON.stringify(event));

    // Handle OPTIONS requests for CORS preflight first
    if (event.httpMethod === "OPTIONS") {
      return {
        statusCode: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: "CORS preflight successful" }),
      };
    }
    
    // Log the whole event for debugging authentication issues
    console.log("Full event:", JSON.stringify(event, null, 2));
    
    // Check if we should return only summary data (metrics without files)
    const summaryOnly = event.queryStringParameters?.summaryOnly === "true";
    // Check if we want files for a specific stage only
    const stageFilter = event.queryStringParameters?.stageFilter;
    
    console.log(`Summary only mode: ${summaryOnly}`);
    console.log(`Stage filter: ${stageFilter || "none"}`);
    
    // Control whether to return file trees or just basic stats
    const skipFileTree = event.queryStringParameters?.skipFileTree === "true";
    console.log(`Skip file tree: ${skipFileTree}`);

    // Get the user's email from the context that the authorizer added
    // API Gateway can have the context in different locations depending on configuration
    // TEMPORARY: Also allow email as a query parameter for testing
    let userEmail =
      event.requestContext?.authorizer?.email ||
      event.requestContext?.authorizer?.claims?.email ||
      event.requestContext?.authorizer?.context?.email ||
      event.queryStringParameters?.email; // Temporary for testing
      
    // Debug auth information  
    console.log("Authorization info:", JSON.stringify({
      direct: event.requestContext?.authorizer?.email,
      claims: event.requestContext?.authorizer?.claims?.email,
      context: event.requestContext?.authorizer?.context?.email,
      queryEmail: event.queryStringParameters?.email,
      fullAuthorizer: event.requestContext?.authorizer,
      headers: event.headers
    }));

    // TEMPORARY: For development/testing, if no email provided, use a default test user
    if (!userEmail && process.env.NODE_ENV !== 'production') {
      console.log("Using default test user email");
      userEmail = "test.user@example.com";
    }

    if (!userEmail) {
      // No email is available - check if any Authorization header exists
      console.log("No email found in context or parameters - checking authorization header directly");
      
      const authHeader = event.headers?.Authorization || event.headers?.authorization;
      if (authHeader) {
        // Try to extract email from JWT token or use a default if we can't
        try {
          console.log("Authorization header found, attempting to extract information...");
          
          // Extract token from the Authorization header
          const parts = authHeader.split(" ");
          if (parts.length === 2 && parts[0] === "Bearer") {
            const token = parts[1];
            
            // Try to decode the token (JWT tokens are base64url encoded)
            console.log("Token found, attempting to decode payload...");
            
            // Get the payload section (second part of JWT)
            const tokenParts = token.split(".");
            if (tokenParts.length >= 2) {
              // Decode the payload
              const payload = Buffer.from(tokenParts[1], 'base64').toString();
              try {
                const parsed = JSON.parse(payload);
                if (parsed.email) {
                  console.log(`Successfully extracted email from token: ${parsed.email}`);
                  userEmail = parsed.email;
                } else {
                  console.log("Token decoded but no email found");
                  // Use sub or a default
                  userEmail = parsed.sub || "anonymous";
                }
              } catch (parseErr) {
                console.log("Error parsing token payload:", parseErr);
              }
            }
          }
        } catch (tokenErr) {
          console.error("Error extracting info from authorization header:", tokenErr);
        }
      }
      
      // If we still don't have an email, use a default
      if (!userEmail) {
        console.warn("Could not extract email - using anonymous access");
        userEmail = "anonymous-user";
      }
    }

    console.log(`Using email: ${userEmail}`);

    // No sanitization needed - using email with @ symbol directly as the folder prefix
    const sanitizedEmail = userEmail;
    console.log(`Using original email with @ symbol: "${userEmail}"`);
    
    // Simple check of bucket contents to verify access
    try {
      console.log("Checking bucket access...");
      const keyCheckParams = {
        Bucket: process.env.S3_BUCKET_NAME,
        MaxKeys: 5
      };
      
      const keyResponse = await s3.listObjectsV2(keyCheckParams).promise();
      if (keyResponse.Contents && keyResponse.Contents.length > 0) {
        console.log(`Bucket access confirmed. Found ${keyResponse.Contents.length} objects in bucket root.`);
      } else {
        console.log("Bucket appears to be empty or there may be permissions issues.");
      }
    } catch (keyError) {
      console.error("Error checking bucket access:", keyError);
    }

    // Get stage from query parameters or default to stage1
    // Add support for preprocessed stage
    let stage = event.queryStringParameters?.stage || "stage1";
    
    // Ensure stage is a valid value
    if (!["stage1", "stage2", "stage3", "preprocessed"].includes(stage)) {
      console.log(`Invalid stage value "${stage}", defaulting to stage1`);
      stage = "stage1";
    }
    
    console.log(`Using stage: ${stage}`);
    
    // Check if the client wants to include data from all stages
    const includeAllStages = event.queryStringParameters?.includeAllStages === "true";
    console.log(`Include data from all stages: ${includeAllStages}`);

    // Verify environment variables are set
    if (!process.env.S3_BUCKET_NAME) {
      console.error("S3_BUCKET_NAME environment variable is not set");
      throw new Error("Lambda configuration error: S3_BUCKET_NAME is not set");
    } else {
      console.log("Using S3_BUCKET_NAME:", process.env.S3_BUCKET_NAME);
    }

    // Create S3 client
    const s3 = new AWS.S3();
    
    // Try to verify S3 access rights with headBucket
    try {
      console.log("Verifying S3 bucket access permissions...");
      const headResult = await s3.headBucket({ Bucket: process.env.S3_BUCKET_NAME }).promise();
      console.log("Bucket access verified successfully:", JSON.stringify(headResult));
    } catch (bucketError) {
      console.error("Error accessing bucket - possible permissions issue:", bucketError);
      // Continue anyway, sometimes headBucket needs different permissions than listObjects
    }

    // List all objects in the user's prefix
    const userPrefix = `${sanitizedEmail}/${stage}/`;
    console.log(`Listing objects with prefix: ${userPrefix}`);
    console.log(`Using S3 bucket: ${process.env.S3_BUCKET_NAME}`);
    
    // Try to check what's in the entire bucket first to debug
    try {
      console.log("Listing ALL objects in bucket to find where files are stored...");
      
      // Get the first 100 objects to analyze the structure
      const listAllParams = {
        Bucket: process.env.S3_BUCKET_NAME,
        MaxKeys: 100
      };
      
      const listAllResponse = await s3.listObjectsV2(listAllParams).promise();
      
      if (listAllResponse.Contents && listAllResponse.Contents.length > 0) {
        console.log(`Found ${listAllResponse.Contents.length} objects in bucket total`);
        
        // Group by prefix pattern to help discover the structure
        const directoryPatterns = {};
        
        listAllResponse.Contents.forEach(obj => {
          const key = obj.Key;
          const segments = key.split('/');
          
          // First segment could be the username/email
          const firstSegment = segments[0] || '';
          
          // Track first-level directories and their counts
          if (!directoryPatterns[firstSegment]) {
            directoryPatterns[firstSegment] = {
              count: 0,
              size: 0,
              hasStage1: false,
              files: []
            };
          }
          
          directoryPatterns[firstSegment].count++;
          directoryPatterns[firstSegment].size += obj.Size;
          
          // Check if this matches our expected stage structure
          if (segments.length > 1 && segments[1] === 'stage1') {
            directoryPatterns[firstSegment].hasStage1 = true;
          }
          
          // Store some sample files for debugging (limit to 3 per prefix)
          if (directoryPatterns[firstSegment].files.length < 3) {
            directoryPatterns[firstSegment].files.push(key);
          }
        });
        
        console.log("Directory patterns found:", JSON.stringify(directoryPatterns, null, 2));
        
        // Log potential matches for our email format
        const emailWithoutDomain = userEmail.split('@')[0];
        const potentialMatches = Object.keys(directoryPatterns).filter(key => 
          key.includes(emailWithoutDomain) || 
          key.toLowerCase().includes(emailWithoutDomain.toLowerCase())
        );
        
        if (potentialMatches.length > 0) {
          console.log("Potential matches for email:", potentialMatches);
        } else {
          console.log("No obvious matches for email pattern:", emailWithoutDomain);
        }
      } else {
        console.log("Bucket appears to be empty - no files found");
      }
    } catch (listError) {
      console.error("Error listing all objects:", listError);
    }
    
    // Debug: List the root of the bucket to see what's available
    try {
      console.log("Trying to list root level directories...");
      const rootParams = {
        Bucket: process.env.S3_BUCKET_NAME,
        Delimiter: '/',
        MaxKeys: 20
      };
      const rootResponse = await s3.listObjectsV2(rootParams).promise();
      console.log("Root listing results:", JSON.stringify({
        commonPrefixes: rootResponse.CommonPrefixes || [],
        contents: (rootResponse.Contents || []).map(item => ({ key: item.Key, size: item.Size })),
        count: rootResponse.KeyCount || 0
      }, null, 2));
    } catch (rootError) {
      console.error("Error listing root of bucket:", rootError);
    }
    
    // Try to list the specific user directory
    try {
      console.log(`DEBUG: Trying to list specific user folder: ${sanitizedEmail}/`);
      const userDirParams = {
        Bucket: process.env.S3_BUCKET_NAME,
        Prefix: `${sanitizedEmail}/`,
        MaxKeys: 20
      };
      const userDirResponse = await s3.listObjectsV2(userDirParams).promise();
      console.log("User directory listing results:", JSON.stringify({
        prefix: userDirParams.Prefix,
        contents: (userDirResponse.Contents || []).map(item => ({ key: item.Key, size: item.Size })),
        count: userDirResponse.KeyCount || 0
      }, null, 2));
    } catch (userDirError) {
      console.error("Error listing user directory:", userDirError);
    }

    // Use pagination to handle large numbers of files
    let filesByStage = {
      stage1: [],
      preprocessed: [],
      stage2: [],
      stage3: []
    };
    let allFiles = [];
    
    // If we need to get data from all stages
    if (includeAllStages) {
      console.log("Getting data from all stages");
      
      // Process each stage separately
      for (const currentStage of ['stage1', 'preprocessed', 'stage2', 'stage3']) {
        const stagePrefix = `${sanitizedEmail}/${currentStage}/`;
        console.log(`Listing files for stage: ${currentStage}, prefix: ${stagePrefix}`);
        
        let stageToken = null;
        do {
          const listParams = {
            Bucket: process.env.S3_BUCKET_NAME,
            Prefix: stagePrefix,
            MaxKeys: 1000,
            ContinuationToken: stageToken
          };
          
          const response = await s3.listObjectsV2(listParams).promise();
          console.log(`Stage ${currentStage}: Found ${response.KeyCount || 0} files`);
          
          if (response.Contents && response.Contents.length > 0) {
            filesByStage[currentStage] = [...filesByStage[currentStage], ...response.Contents];
            
            // If this is the requested stage, also add to allFiles for backward compatibility
            if (currentStage === stage) {
              allFiles = [...allFiles, ...response.Contents];
            }
          }
          
          stageToken = response.IsTruncated ? response.NextContinuationToken : null;
        } while (stageToken);
      }
      
      console.log(`Files by stage counts: stage1=${filesByStage.stage1.length}, stage2=${filesByStage.stage2.length}, stage3=${filesByStage.stage3.length}`);
    } 
    // Otherwise just get data for the specified stage as before
    else {
      let continuationToken = null;
      console.log(`Starting pagination for specific prefix: ${userPrefix}`);
      
      do {
        const listParams = {
          Bucket: process.env.S3_BUCKET_NAME,
          Prefix: userPrefix,
          MaxKeys: 1000, // Maximum number of keys to return in each request
          ContinuationToken: continuationToken
        };

        console.log(`Listing objects with params:`, JSON.stringify(listParams));
        
        const response = await s3.listObjectsV2(listParams).promise();
        
        console.log(`ListObjectsV2 response: KeyCount=${response.KeyCount}, IsTruncated=${response.IsTruncated}`);
        
        if (response.Contents && response.Contents.length > 0) {
          console.log(`Found ${response.Contents.length} files in this batch`);
          console.log("First few files:", JSON.stringify(response.Contents.slice(0, 3).map(f => ({ key: f.Key, size: f.Size }))));
          allFiles = [...allFiles, ...response.Contents];
          filesByStage[stage] = [...allFiles];
        } else {
          console.log(`No files found in this batch`);
        }
        
        continuationToken = response.IsTruncated ? response.NextContinuationToken : null;
      } while (continuationToken);
    }

    // If no files were found with the exact prefix, log the issue but don't try alternative formats
    if (allFiles.length === 0) {
      console.log(`No files found with exact prefix: ${userPrefix}`);
      console.log("Email format is expected to contain @ symbol and not be sanitized");
      
      // Check if we have general bucket access
      try {
        console.log("Testing bucket access to verify permissions");
        const testParams = {
          Bucket: process.env.S3_BUCKET_NAME,
          MaxKeys: 5
        };
        
        const testResponse = await s3.listObjectsV2(testParams).promise();
        if (testResponse.Contents && testResponse.Contents.length > 0) {
          console.log(`Bucket access successful. Found ${testResponse.Contents.length} files in the root.`);
          console.log("No files exist for this specific user and stage.");
        } else {
          console.log("Bucket appears to be empty or there may be permissions issues.");
        }
      } catch (error) {
        console.error("Error testing bucket access:", error);
      }
    }
    
    console.log(`Found ${allFiles.length} files`);

    // Calculate metrics
    const totalSize = allFiles.reduce((total, file) => total + (file.Size || 0), 0);
    const fileCount = allFiles.length;
    
    console.log(`Total size: ${totalSize} bytes, File count: ${fileCount}`);

    // Function to format file size in human-readable format
    const formatBytes = (bytes, decimals = 2) => {
      if (bytes === 0) return "0 Bytes";
      const k = 1024;
      const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + " " + sizes[i];
    };

    // Process files into tree structure using the exact prefix provided
    console.log(`Building file tree with prefix: "${userPrefix}"`);
    const fileTree = buildFileTree(allFiles, userPrefix);

    // If we got data from all stages, process each stage's data
    if (includeAllStages) {
      console.log("Processing data from all stages for response");
      
      // Get data from stage2 for categorized data
      let categorizedData = {};
      let categoryTypes = [];
      
      if (filesByStage.stage2.length > 0) {
        console.log(`Processing ${filesByStage.stage2.length} files from stage2`);
        
        // Log all stage2 files to debug
        console.log("All stage2 files:", filesByStage.stage2.map(file => ({
          key: file.Key,
          size: file.Size,
          lastModified: file.LastModified
        })));
        
        try {
          // Look for categorized data JSON files
          for (const file of filesByStage.stage2) {
            console.log(`Examining stage2 file: ${file.Key}, isJson: ${file.Key.endsWith('.json')}`);
            
            if (file.Key.endsWith('.json')) {
              console.log(`Checking stage2 file: ${file.Key}`);
              
              try {
                // Get the file content
                const fileData = await s3.getObject({
                  Bucket: process.env.S3_BUCKET_NAME,
                  Key: file.Key
                }).promise();
                
                console.log(`Successfully read file: ${file.Key}, content length: ${fileData.Body.length}`);
                
                // Parse the JSON content
                const contentString = fileData.Body.toString('utf-8');
                console.log(`File content preview: ${contentString.substring(0, 100)}...`);
                
                const fileContent = JSON.parse(contentString);
                console.log(`Successfully parsed JSON, found categories: ${fileContent.categories ? Object.keys(fileContent.categories).join(', ') : 'none'}`);
                
                // Store categorized data by file name
                const fileName = file.Key.split('/').pop();
                categorizedData[fileName] = fileContent;
                console.log(`Added ${fileName} to categorizedData, now have ${Object.keys(categorizedData).length} files`);
                
                // Track category types
                if (fileContent.categories) {
                  Object.keys(fileContent.categories).forEach(cat => {
                    if (!categoryTypes.includes(cat)) {
                      categoryTypes.push(cat);
                      console.log(`Added category type: ${cat}`);
                    }
                  });
                }
              } catch (fileError) {
                console.error(`Error processing individual file ${file.Key}:`, fileError);
              }
            }
          }
          
          console.log(`Final result: ${Object.keys(categorizedData).length} categorized files with ${categoryTypes.length} category types`);
        } catch (catError) {
          console.error("Error processing stage2 categorized data:", catError);
        }
      } else {
        console.log("No stage2 files found to process");
      }
      
      // Get persona data from stage3
      let personas = null;
      
      if (filesByStage.stage3.length > 0) {
        console.log(`Processing ${filesByStage.stage3.length} files from stage3`);
        
        // Log all stage3 files to debug
        console.log("All stage3 files:", filesByStage.stage3.map(file => ({
          key: file.Key,
          size: file.Size,
          lastModified: file.LastModified
        })));
        
        try {
          // Look for personas.json file - try both with and without trailing slash
          // First check with exact filename match
          let personaFile = filesByStage.stage3.find(file => file.Key.endsWith('personas.json'));
          
          // If not found, try with slash
          if (!personaFile) {
            personaFile = filesByStage.stage3.find(file => file.Key.endsWith('/personas.json'));
            console.log("Tried with trailing slash, found:", personaFile ? personaFile.Key : "not found");
          }
          
          // If still not found, look for any JSON file as a fallback
          if (!personaFile) {
            personaFile = filesByStage.stage3.find(file => file.Key.endsWith('.json'));
            console.log("Fallback to any JSON in stage3, found:", personaFile ? personaFile.Key : "not found");
          }
          
          if (personaFile) {
            console.log(`Found personas file: ${personaFile.Key}`);
            
            try {
              // Get the file content
              const personaData = await s3.getObject({
                Bucket: process.env.S3_BUCKET_NAME,
                Key: personaFile.Key
              }).promise();
              
              console.log(`Successfully read personas file, content length: ${personaData.Body.length}`);
              
              // Parse the JSON content
              const contentString = personaData.Body.toString('utf-8');
              console.log(`Personas file content preview: ${contentString.substring(0, 100)}...`);
              
              personas = JSON.parse(contentString);
              console.log(`Successfully parsed personas JSON, found types: ${Object.keys(personas).join(', ')}`);
            } catch (fileError) {
              console.error(`Error processing personas file ${personaFile.Key}:`, fileError);
            }
          } else {
            console.log("No personas.json file found in stage3");
            
            // List all files with their full paths for debugging
            console.log("All stage3 file paths:", filesByStage.stage3.map(file => file.Key));
          }
        } catch (personaError) {
          console.error("Error processing stage3 persona data:", personaError);
        }
      } else {
        console.log("No stage3 files found to process");
      }
      
      // Process the main stage data (stage1 by default)
      // Build the tree structure for the requested stage
      console.log(`Building file tree for stage ${stage} with prefix: "${userPrefix}"`);
      const fileTree = buildFileTree(allFiles, userPrefix);
      
      // Prepare metrics summary data
      const metricsData = {
        fileCount,
        totalSize,
        totalSizeFormatted: formatBytes(totalSize),
        lastUpdated: allFiles.length > 0 
          ? new Date(Math.max(...allFiles.map(file => file.LastModified?.getTime() || 0))).toISOString()
          : null,
        stageMetrics: {
          stage1: {
            fileCount: filesByStage.stage1.length,
            totalSize: filesByStage.stage1.reduce((total, file) => total + (file.Size || 0), 0),
            totalSizeFormatted: formatBytes(filesByStage.stage1.reduce((total, file) => total + (file.Size || 0), 0))
          },
          preprocessed: {
            fileCount: filesByStage.preprocessed ? filesByStage.preprocessed.length : 0,
            totalSize: filesByStage.preprocessed ? 
              filesByStage.preprocessed.reduce((total, file) => total + (file.Size || 0), 0) : 0,
            totalSizeFormatted: formatBytes(filesByStage.preprocessed ? 
              filesByStage.preprocessed.reduce((total, file) => total + (file.Size || 0), 0) : 0)
          },
          stage2: {
            fileCount: filesByStage.stage2.length,
            totalSize: filesByStage.stage2.reduce((total, file) => total + (file.Size || 0), 0),
            totalSizeFormatted: formatBytes(filesByStage.stage2.reduce((total, file) => total + (file.Size || 0), 0))
          },
          stage3: {
            fileCount: filesByStage.stage3.length,
            totalSize: filesByStage.stage3.reduce((total, file) => total + (file.Size || 0), 0),
            totalSizeFormatted: formatBytes(filesByStage.stage3.reduce((total, file) => total + (file.Size || 0), 0))
          }
        }
      };
      
      // Initialize response payload with metrics
      const responsePayload = {
        metrics: metricsData
      };
      
      // Only include file tree if not skipped
      if (!skipFileTree) {
        responsePayload.fileTree = fileTree;
      }
      
      // Handle file filtering by stage or don't include files if summary only
      if (!summaryOnly) {
        if (stageFilter) {
          // If a specific stage is requested, only return files from that stage
          const filteredFiles = filesByStage[stageFilter] || [];
          const filteredPrefix = `${sanitizedEmail}/${stageFilter}/`;
          
          responsePayload.files = filteredFiles.map(file => ({
            key: file.Key,
            size: file.Size,
            lastModified: file.LastModified,
            eTag: file.ETag, 
            storageClass: file.StorageClass,
            relativePath: file.Key.slice(filteredPrefix.length)
          }));
          
          console.log(`Returning ${filteredFiles.length} files from stage: ${stageFilter}`);
        } else {
          // Otherwise return all files (from the requested stage in case of non-includeAllStages)
          responsePayload.files = allFiles.map(file => ({
            key: file.Key,
            size: file.Size,
            lastModified: file.LastModified,
            eTag: file.ETag,
            storageClass: file.StorageClass,
            relativePath: file.Key.slice(userPrefix.length)
          }));
        }
      } else {
        console.log("Summary mode enabled, skipping file details to reduce payload size");
      }
      
      // Only add categorized data if we actually have files with categories
      // and we're not in summary-only mode
      if (Object.keys(categorizedData).length > 0 && !summaryOnly) {
        console.log(`Adding ${Object.keys(categorizedData).length} categorized files to response`);
        responsePayload.categorized = {
          files: categorizedData,
          categoryTypes: categoryTypes
        };
      } else if (Object.keys(categorizedData).length > 0) {
        // In summary mode, just include category types and counts
        console.log(`Adding summary of ${categoryTypes.length} category types`);
        responsePayload.categorized = {
          count: Object.keys(categorizedData).length,
          categoryTypes: categoryTypes,
          // Skip detailed file data
        };
      } else {
        console.log("No categorized files to add to response");
      }
      
      // Only add personas if we actually have persona data
      if (personas && Object.keys(personas).length > 0) {
        // Personas are relatively small, so include them even in summary mode
        console.log(`Adding personas with ${Object.keys(personas).length} types to response`);
        responsePayload.personas = personas;
      } else {
        console.log("No persona data to add to response");
      }
      
      // Try to get the user master profile
      try {
        const userMasterProfile = await getUserMasterProfile(sanitizedEmail);
        if (userMasterProfile) {
          console.log(`Found user master profile with ${Object.keys(userMasterProfile.userProfile || {}).length} profile sections`);
          responsePayload.userMasterProfile = userMasterProfile;
          
          // Add the persona types to response for summary mode
          if (userMasterProfile.categories) {
            const masterProfileCategories = Object.keys(userMasterProfile.categories);
            console.log(`Adding ${masterProfileCategories.length} categories from master profile`);
            
            // Add unique category types to the list
            if (!responsePayload.categorized) {
              responsePayload.categorized = {
                count: userMasterProfile.fileCount || 0,
                categoryTypes: masterProfileCategories
              };
            } else {
              // Merge with existing category types
              const existingTypes = new Set(responsePayload.categorized.categoryTypes || []);
              for (const category of masterProfileCategories) {
                if (!existingTypes.has(category)) {
                  responsePayload.categorized.categoryTypes.push(category);
                  existingTypes.add(category);
                }
              }
            }
          }
          
          // Add personaTypes from the master profile if available
          if (!responsePayload.personaTypes && userMasterProfile.userProfile) {
            responsePayload.personaTypes = [];
            
            // Extract persona types from affiliations, demographics, etc.
            if (userMasterProfile.userProfile.demographics && Object.keys(userMasterProfile.userProfile.demographics).length > 0) {
              responsePayload.personaTypes.push("demographic");
            }
            
            if (userMasterProfile.userProfile.socialConnections && userMasterProfile.userProfile.socialConnections.length > 0) {
              responsePayload.personaTypes.push("social");
            }
            
            if (userMasterProfile.userProfile.affiliations && userMasterProfile.userProfile.affiliations.length > 0) {
              responsePayload.personaTypes.push("professional");
            }
            
            if (userMasterProfile.userProfile.interests && userMasterProfile.userProfile.interests.length > 0) {
              responsePayload.personaTypes.push("interest");
            }
            
            console.log(`Added ${responsePayload.personaTypes.length} persona types from master profile`);
          }
        } else {
          console.log("No user master profile found");
        }
      } catch (profileError) {
        console.error("Error retrieving user master profile:", profileError);
      }
      
      // Calculate approximate response size
      const estimatedSize = JSON.stringify(responsePayload).length;
      console.log(`Estimated response size: ${formatBytes(estimatedSize)}`);
      
      console.log("Response structure:", JSON.stringify({
        metrics: "included",
        fileTree: skipFileTree ? "skipped" : "included",
        files: responsePayload.files ? `${responsePayload.files.length} files` : "not included",
        categorized: responsePayload.categorized ? 
          (responsePayload.categorized.files ? 
            `${Object.keys(responsePayload.categorized.files).length} files` : 
            `${responsePayload.categorized.count} files (summary only)`) 
          : "not included",
        personas: responsePayload.personas ? `${Object.keys(responsePayload.personas).length} types` : "not included"
      }));
      
      // Return the enhanced response
      return {
        statusCode: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(responsePayload),
      };
    } 
    // Standard response for single stage
    else {
      // Prepare metrics data
      const metricsData = {
        fileCount,
        totalSize,
        totalSizeFormatted: formatBytes(totalSize),
        lastUpdated: allFiles.length > 0 
          ? new Date(Math.max(...allFiles.map(file => file.LastModified?.getTime() || 0))).toISOString()
          : null
      };
      
      // Prepare the response payload
      const responsePayload = {
        metrics: metricsData
      };
      
      // Only include file tree if not skipped
      if (!skipFileTree) {
        responsePayload.fileTree = fileTree;
      }
      
      // Only include files if not in summary mode
      if (!summaryOnly) {
        // Filter files by stage if requested
        if (stageFilter) {
          // To filter by stage in the single-stage mode, we need to check if the requested
          // stage matches our current stage, otherwise return empty array
          responsePayload.files = (stageFilter === stage) ? 
            allFiles.map(file => ({
              key: file.Key,
              size: file.Size,
              lastModified: file.LastModified,
              eTag: file.ETag,
              storageClass: file.StorageClass,
              relativePath: file.Key.slice(userPrefix.length)
            })) : [];
          
          console.log(`Filtered to ${responsePayload.files.length} files for stage ${stageFilter}`);
        } else {
          // Include raw files with our standard stage
          responsePayload.files = allFiles.map(file => ({
            key: file.Key,
            size: file.Size,
            lastModified: file.LastModified,
            eTag: file.ETag,
            storageClass: file.StorageClass,
            relativePath: file.Key.slice(userPrefix.length)
          }));
        }
      } else {
        console.log("Summary mode enabled, skipping file details");
      }
      
      // Calculate approximate response size
      const estimatedSize = JSON.stringify(responsePayload).length;
      console.log(`Estimated response size: ${formatBytes(estimatedSize)}`);
      
      // Return the response
      return {
        statusCode: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(responsePayload),
      };
    }
  } catch (error) {
    console.error("Error getting user metrics:", error);

    let errorDetails;
    try {
      // Extract useful information from the error object
      errorDetails = {
        message: error.message,
        code: error.code,
        statusCode: error.statusCode,
        requestId: error.requestId,
        time: error.time,
        retryable: error.retryable,
        service: error.service,
        region: error.region,
      };
    } catch (e) {
      errorDetails = { message: error.message };
    }

    return {
      statusCode: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: "Error retrieving user data metrics",
        error: errorDetails,
        stack: error.stack,
      }),
    };
  }
};

/**
 * Builds a tree structure from file paths
 * @param {Array} files - Array of S3 objects
 * @param {string} prefix - The prefix to remove from file keys
 * @returns {Object} A hierarchical tree structure
 */
function buildFileTree(files, prefix) {
  const tree = { name: 'root', type: 'folder', children: [], size: 0 };

  files.forEach(file => {
    // Skip the prefix folder itself
    if (file.Key === prefix) return;

    // Remove the prefix and get the relative path
    const relativePath = file.Key.slice(prefix.length);
    
    // Split the path into parts
    const pathParts = relativePath.split('/');
    
    // Start at the root of the tree
    let currentNode = tree;
    
    // Create folder nodes as needed
    for (let i = 0; i < pathParts.length - 1; i++) {
      const part = pathParts[i];
      if (!part) continue; // Skip empty parts
      
      // Check if folder node already exists
      let folderNode = currentNode.children.find(node => node.name === part && node.type === 'folder');
      
      // If not, create it
      if (!folderNode) {
        folderNode = { name: part, type: 'folder', children: [], size: 0, parent: currentNode };
        currentNode.children.push(folderNode);
      }
      
      // Move to this folder for the next iteration
      currentNode = folderNode;
    }
    
    // Add the file to the current node
    const fileName = pathParts[pathParts.length - 1];
    if (fileName) {
      const fileNode = {
        name: fileName,
        type: 'file',
        size: file.Size,
        lastModified: file.LastModified,
        eTag: file.ETag,
        storageClass: file.StorageClass,
        key: file.Key
      };
      
      currentNode.children.push(fileNode);
      
      // Update folder sizes up the tree
      let node = currentNode;
      while (node) {
        node.size += file.Size;
        node = node.parent; // This requires adding parent references
      }
    }
  });
  
  // Sort children in each folder (folders first, then files)
  const sortNode = (node) => {
    if (node.children) {
      // Sort children: folders first (alphabetically), then files (alphabetically)
      node.children.sort((a, b) => {
        if (a.type === 'folder' && b.type === 'file') return -1;
        if (a.type === 'file' && b.type === 'folder') return 1;
        return a.name.localeCompare(b.name);
      });
      
      // Recursively sort children
      node.children.forEach(sortNode);
    }
  };
  
  sortNode(tree);
  
  // Remove parent references to fix circular JSON issue
  const removeParentReferences = (node) => {
    if (node.parent) {
      delete node.parent;
    }
    if (node.children) {
      node.children.forEach(removeParentReferences);
    }
  };
  
  // Remove parent references before returning the tree
  removeParentReferences(tree);
  
  return tree;
}

/**
 * Retrieve the user master profile from S3
 * @param {string} userPrefix - The user's prefix in S3
 * @returns {Promise<Object|null>} - The user master profile, or null if not found
 */
async function getUserMasterProfile(userPrefix) {
  const masterFileKey = `${userPrefix}/stage2/user_master_profile.json`;
  
  console.log(`Looking for user master profile: ${masterFileKey}`);

  try {
    const params = {
      Bucket: process.env.S3_BUCKET_NAME,
      Key: masterFileKey,
    };

    const data = await s3.getObject(params).promise();
    console.log(`Found user master profile, size: ${data.ContentLength || data.Body.length} bytes`);
    return JSON.parse(data.Body.toString('utf-8'));
  } catch (error) {
    // If the file doesn't exist yet, that's ok - just return null
    if (error.code === 'NoSuchKey') {
      console.log(`User master profile not found: ${masterFileKey}`);
      return null;
    }
    console.error(`Error retrieving user master profile: ${error.message}`);
    throw new Error(`Failed to retrieve user master profile: ${error.message}`);
  }
}

// Adding a timestamp comment to verify update: Sat May 17 18:04:51 IST 2025
// Adding comment to verify update: Sat May 17 18:05:19 IST 2025
// Adding comment to verify update: Sat May 17 18:05:41 IST 2025
