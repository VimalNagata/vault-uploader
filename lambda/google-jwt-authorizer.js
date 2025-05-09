const { OAuth2Client } = require("google-auth-library");
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const https = require("https");

/**
 * Custom API Gateway authorizer for Google tokens
 *
 * This function:
 * 1. Extracts the token from either Authorization header or authorizationToken field
 * 2. Verifies the token using Google's authentication services
 * 3. Generates an IAM policy allowing/denying access based on the token validity
 */
exports.handler = async (event) => {
  console.log("Event received:", JSON.stringify(event));

  try {
    let token;
    
    // For API Gateway authorizers, the token comes in authorizationToken
    if (event.type === 'TOKEN') {
      // TOKEN authorizer pattern
      if (!event.authorizationToken) {
        throw new Error('authorizationToken not found in event');
      }
      
      const authHeader = event.authorizationToken;
      const parts = authHeader.split(' ');
      if (parts.length !== 2 || parts[0] !== 'Bearer') {
        throw new Error('authorizationToken must be in format "Bearer <token>"');
      }
      token = parts[1];
    } else {
      // Regular API event pattern (headers)
      const authHeader = 
        event.headers?.Authorization || event.headers?.authorization;
      if (!authHeader) {
        throw new Error("Authorization header not found");
      }
      
      // Expected format: "Bearer <token>"
      const parts = authHeader.split(" ");
      if (parts.length !== 2 || parts[0] !== "Bearer") {
        throw new Error(
          'Authorization header must be in format "Bearer <token>"'
        );
      }
      token = parts[1];
    }

    // Check if it's an access token
    const tokenInfo = await verifyGoogleToken(token);

    // Use user information from the token info
    const userId = tokenInfo.sub || tokenInfo.user_id || "google-user";
    const email = tokenInfo.email;

    if (!email) {
      throw new Error("Email not found in token");
    }

    // Check if email is verified (if this info is available)
    if (tokenInfo.email_verified === false) {
      throw new Error("Email not verified with Google");
    }

    // Generate policy document for API Gateway
    console.log(`Generating policy for user ${userId} with email ${email}`);
    const policyDocument = generatePolicy(userId, "Allow", event.methodArn, {
      email: email,
      name: tokenInfo.name,
      picture: tokenInfo.picture,
    });

    console.log("Generated policy document:", JSON.stringify(policyDocument));
    return policyDocument;
  } catch (error) {
    console.error("Authentication error:", error);
    // Generate a deny policy
    return generatePolicy("user", "Deny", event.methodArn);
  }
};

/**
 * Verify a Google token (either ID token or access token)
 */
async function verifyGoogleToken(token) {
  try {
    // First try as an ID token
    try {
      const ticket = await client.verifyIdToken({
        idToken: token,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      const payload = ticket.getPayload();
      console.log("Successfully verified ID token:", JSON.stringify(payload));
      return payload;
    } catch (idTokenError) {
      console.log("Not a valid ID token, trying as access token...", idTokenError.message);
      // If not an ID token, try as an access token
      const tokenInfo = await getTokenInfo(token);
      console.log("Successfully verified access token:", JSON.stringify(tokenInfo));
      return tokenInfo;
    }
  } catch (error) {
    console.error("Token verification failed:", error);
    throw error;
  }
}

/**
 * Get token info from Google for an access token
 */
function getTokenInfo(accessToken) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "www.googleapis.com",
      path: `/oauth2/v3/tokeninfo?access_token=${accessToken}`,
      method: "GET",
    };
    
    console.log(`Fetching token info from Google: ${options.hostname}${options.path}`);

    const req = https.request(options, (res) => {
      let data = "";

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        console.log(`Token info response: Status code: ${res.statusCode}`);
        
        if (res.statusCode === 200) {
          try {
            const tokenInfo = JSON.parse(data);
            console.log("Token info successfully parsed:", JSON.stringify(tokenInfo));
            resolve(tokenInfo);
          } catch (e) {
            console.error("Failed to parse token info:", e);
            reject(new Error("Failed to parse token info"));
          }
        } else {
          console.error(`Invalid token response: ${res.statusCode}`, data);
          reject(new Error(`Invalid token: ${res.statusCode} - ${data}`));
        }
      });
    });

    req.on("error", (e) => {
      console.error("Error fetching token info:", e);
      reject(e);
    });

    req.end();
  });
}

/**
 * Generate IAM policy for API Gateway
 */
function generatePolicy(principalId, effect, resource, context) {
  const authResponse = {
    principalId: principalId,
  };

  if (effect && resource) {
    // For custom authorizers, we need to generate a wildcard policy
    // that allows access to all methods of the API
    const apiGatewayArnTmp = resource.split(':');
    const awsAccountId = apiGatewayArnTmp[4];
    const awsRegion = apiGatewayArnTmp[3];
    const restApiId = apiGatewayArnTmp[5].split('/')[0];
    const stage = apiGatewayArnTmp[5].split('/')[1];
    const resourceArn = 'arn:aws:execute-api:' + awsRegion + ':' + awsAccountId + ':' + restApiId + '/' + stage + '/*/*';
    
    const policyDocument = {
      Version: "2012-10-17",
      Statement: [
        {
          Action: "execute-api:Invoke",
          Effect: effect,
          Resource: resourceArn,
        },
      ],
    };

    authResponse.policyDocument = policyDocument;
  }

  // Include additional context if provided
  if (context) {
    authResponse.context = context;
  }

  return authResponse;
}