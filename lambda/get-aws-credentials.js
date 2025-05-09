// Include AWS SDK
const AWS = require("aws-sdk");

/**
 * Lambda function to generate temporary AWS credentials for authenticated users
 *
 * This function:
 * 1. Verifies the user is authenticated (through API Gateway Authorizer)
 * 2. Uses AWS STS to generate temporary credentials
 * 3. Returns the credentials to the client
 */
exports.handler = async (event) => {
  try {
    console.log("Event received:", JSON.stringify(event));

    // Handle OPTIONS requests for CORS preflight first
    if (event.httpMethod === "OPTIONS") {
      return {
        statusCode: 200,
        headers: {
          "Access-Control-Allow-Origin": "*", // Update for production
          "Access-Control-Allow-Headers": "Content-Type,Authorization",
          "Access-Control-Allow-Methods": "GET,OPTIONS",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: "CORS preflight successful" }),
      };
    }

    // Get the user's email from the context that the authorizer added
    // API Gateway can have the context in different locations depending on how it's configured
    const userEmail =
      event.requestContext?.authorizer?.email ||
      event.requestContext?.authorizer?.claims?.email ||
      event.requestContext?.authorizer?.context?.email;

    if (!userEmail) {
      console.error(
        "No user email found in authorizer context:",
        JSON.stringify(event.requestContext?.authorizer || {})
      );
      return {
        statusCode: 401,
        headers: {
          "Access-Control-Allow-Origin": "*", // Update for production
          "Access-Control-Allow-Headers": "Content-Type,Authorization",
          "Access-Control-Allow-Methods": "GET,OPTIONS",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message:
            "User not authenticated. No email found in authorizer context.",
          context: event.requestContext?.authorizer || "No authorizer context",
          event: JSON.stringify(event),
        }),
      };
    }

    console.log(`Using email: ${userEmail}`);

    // Clean the email to use as a folder prefix and for session naming
    const sanitizedEmail = userEmail.replace(/[^a-zA-Z0-9._-]/g, "_");

    // Create an STS client
    const sts = new AWS.STS();

    // Verify environment variables are set and debug their values
    if (!process.env.S3_ROLE_ARN) {
      console.error("S3_ROLE_ARN environment variable is not set");
      throw new Error("Lambda configuration error: S3_ROLE_ARN is not set");
    } else {
      console.log("Using S3_ROLE_ARN:", process.env.S3_ROLE_ARN);
    }

    if (!process.env.S3_BUCKET_NAME) {
      console.error("S3_BUCKET_NAME environment variable is not set");
      throw new Error("Lambda configuration error: S3_BUCKET_NAME is not set");
    } else {
      console.log("Using S3_BUCKET_NAME:", process.env.S3_BUCKET_NAME);
    }

    // Log Lambda execution role for debugging
    try {
      const currentIdentity = await sts.getCallerIdentity().promise();
      console.log(
        "Lambda execution identity:",
        JSON.stringify(currentIdentity)
      );
      console.log("Lambda execution ARN:", currentIdentity.Arn);
      console.log("Lambda execution UserId:", currentIdentity.UserId);
      console.log("Lambda execution Account:", currentIdentity.Account);
    } catch (e) {
      console.error("Failed to get Lambda execution identity:", e);
    }

    // Generate temporary credentials using AssumeRole
    // Using the policy set in the console (no inline policy)
    
    // The session name will be used for policy conditions in the role's policy
    // Set it to the sanitized email - this way the policy can reference ${aws:username}
    const sessionName = sanitizedEmail;
    
    console.log(`Using session name: ${sessionName} for role assumption`);
    console.log(`This session name can be used in your role policy for conditions like:
    - "StringLike": {"aws:userId": "*:${sessionName}"}
    - Or in resource paths like "arn:aws:s3:::${process.env.S3_BUCKET_NAME}/*/${sessionName}/*"`);

    // Assume the pre-configured role WITHOUT specifying an inline policy
    // This means it will use the policy attached to the role in AWS console
    const params = {
      RoleArn: process.env.S3_ROLE_ARN,
      RoleSessionName: sessionName,
      DurationSeconds: 3600 // 1 hour
    };

    console.log(
      "Calling STS assumeRole with params:",
      JSON.stringify({
        RoleArn: params.RoleArn,
        RoleSessionName: params.RoleSessionName,
        DurationSeconds: params.DurationSeconds
      })
    );

    // Call assumeRole
    console.log("Making STS assumeRole API call...");
    const credentials = await sts.assumeRole(params).promise();

    // Log detailed information about the assumed role
    console.log(
      "STS AssumeRole Response:",
      JSON.stringify({
        // Credentials info
        AccessKeyId: credentials.Credentials.AccessKeyId,
        Expiration: credentials.Credentials.Expiration,
        // Don't log sensitive info like secretAccessKey and sessionToken

        // Role info
        AssumedRoleId: credentials.AssumedRoleId,
        AssumedRoleARN: credentials.AssumedRoleUser?.Arn,
        AssumedRoleUser: credentials.AssumedRoleUser,

        // Additional details
        PackedPolicySize: credentials.PackedPolicySize,
        RequestId: credentials.$response?.requestId,
        RetryAttempts: credentials.$response?.retryCount,
      })
    );

    // Try to get information about the assumed role
    try {
      const roleInfo = await sts.getCallerIdentity().promise();
      console.log(
        "Caller identity after assuming role:",
        JSON.stringify(roleInfo)
      );
    } catch (identityError) {
      console.error("Error getting identity info:", identityError);
    }

    // Return the credentials to the client
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*", // Update for production
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
        "Access-Control-Allow-Methods": "GET,OPTIONS",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        credentials: {
          accessKeyId: credentials.Credentials.AccessKeyId,
          secretAccessKey: credentials.Credentials.SecretAccessKey,
          sessionToken: credentials.Credentials.SessionToken,
          expiration: credentials.Credentials.Expiration,
        },
        userInfo: {
          email: userEmail,
          s3Prefix: sanitizedEmail,
        },
        bucketName: process.env.S3_BUCKET_NAME,
        region: process.env.AWS_REGION,
      }),
    };
  } catch (error) {
    console.error("Error generating credentials:", error);

    // Add more detailed debugging for common errors
    if (error.code === "AccessDenied") {
      console.error(
        "ACCESS DENIED ERROR: This usually means the Lambda execution role does not have permission to assume the S3 role."
      );
      console.error("Verify that:");
      console.error(
        "1. The Lambda role has sts:AssumeRole permission for the S3 role"
      );
      console.error(
        "2. The S3 role trust policy allows the Lambda role to assume it"
      );
      console.error(
        "3. The S3_ROLE_ARN is correct in the Lambda environment variables"
      );
    } else if (error.code === "InvalidClientTokenId") {
      console.error(
        "INVALID CLIENT TOKEN ERROR: The AWS credentials used by the Lambda function may be invalid."
      );
    } else if (error.code === "ValidationError") {
      console.error(
        "VALIDATION ERROR: Check if the policy format is correct and within size limits."
      );
      console.error("Consider simplifying the policy if it's too large.");
    }

    let errorDetails;
    try {
      // Try to extract useful information from the error object
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
        "Access-Control-Allow-Origin": "*", // Update for production
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
        "Access-Control-Allow-Methods": "GET,OPTIONS",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: "Error generating credentials",
        error: errorDetails,
        stack: error.stack,
      }),
    };
  }
};