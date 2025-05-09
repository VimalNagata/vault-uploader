/**
 * Authentication Service
 * Handles authentication and AWS credential retrieval
 */

// API Gateway endpoint URL - replace with your deployed Lambda function URL
// For production builds, we'll use a hardcoded URL if the environment variable is not available
const CREDENTIALS_API_URL = process.env.REACT_APP_CREDENTIALS_API_URL || 'https://8dk906qbg3.execute-api.us-east-1.amazonaws.com/prod/credentials';

interface AWScredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: string;
}

interface UserInfo {
  email: string;
  s3Prefix: string;
}

interface CredentialsResponse {
  credentials: AWScredentials;
  userInfo: UserInfo;
  bucketName: string;
  region: string;
}

class AuthService {
  private googleToken: string | null = null;
  private credentials: AWScredentials | null = null;
  private credentialsExpiry: Date | null = null;
  private lastRefresh: number = 0;

  /**
   * Store Google token from OAuth process
   */
  setGoogleToken(token: string): void {
    this.googleToken = token;
    // Store token in sessionStorage for persistence during page refreshes
    sessionStorage.setItem("dna_google_token", token);
  }

  /**
   * Get Google token, retrieve from sessionStorage if not already set
   */
  getGoogleToken(): string | null {
    if (!this.googleToken) {
      this.googleToken = sessionStorage.getItem("dna_google_token");
    }
    return this.googleToken;
  }

  /**
   * Clear authentication data
   */
  clearAuth(): void {
    this.googleToken = null;
    this.credentials = null;
    this.credentialsExpiry = null;
    this.lastRefresh = 0;
    sessionStorage.removeItem("dna_google_token");
  }

  /**
   * Check if we have valid AWS credentials
   */
  hasValidCredentials(): boolean {
    if (!this.credentials || !this.credentialsExpiry) {
      return false;
    }

    // Add a 5-minute buffer to ensure we don't use about-to-expire credentials
    const now = new Date();
    const bufferMs = 5 * 60 * 1000; // 5 minutes
    return now.getTime() + bufferMs < this.credentialsExpiry.getTime();
  }

  /**
   * Helper function to log headers in a cross-browser way
   */
  private logHeaders(headers: Headers, label: string): void {
    console.log(`${label}:`);
    // Convert headers to an object for easier logging
    const headersObj: Record<string, string> = {};
    headers.forEach((value, key) => {
      headersObj[key] = value;
    });
    console.log(headersObj);
  }

  /**
   * Get AWS credentials from Lambda function
   * Uses Google token for authorization
   */
  async getAWSCredentials(): Promise<CredentialsResponse> {
    // Check if we already have valid credentials
    if (this.hasValidCredentials()) {
      console.log("Using cached AWS credentials that are still valid");
      return {
        credentials: this.credentials!,
        userInfo: JSON.parse(localStorage.getItem("dna_user_info") || "{}"),
        bucketName: localStorage.getItem("dna_bucket_name") || "",
        region: localStorage.getItem("dna_region") || "",
      };
    }

    // Implement rate limiting - don't allow more than one request per second
    const now = Date.now();
    if (now - this.lastRefresh < 1000) {
      throw new Error(
        "Too many credential refresh attempts. Please try again in a moment."
      );
    }
    this.lastRefresh = now;

    const token = this.getGoogleToken();
    if (!token) {
      console.error("No Google token found in session storage or memory");
      throw new Error("Not authenticated. Please sign in with Google first.");
    }

    if (!CREDENTIALS_API_URL) {
      console.error("Credentials API URL not configured.");
      throw new Error(
        "Credentials API URL not configured. Please set REACT_APP_CREDENTIALS_API_URL in your environment."
      );
    }

    try {
      console.log(`Fetching credentials from: ${CREDENTIALS_API_URL}`);
      console.log(`Using token: Bearer ${token.substring(0, 10)}...`);

      // First try with a preflight OPTIONS request
      try {
        const optionsResponse = await fetch(CREDENTIALS_API_URL, {
          method: "OPTIONS",
          headers: {
            Origin: window.location.origin,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "Authorization,Content-Type",
          },
          mode: "cors",
        });

        console.log("OPTIONS response status:", optionsResponse.status);
        this.logHeaders(optionsResponse.headers, "OPTIONS response headers");
      } catch (e) {
        console.warn(
          "OPTIONS preflight failed, continuing with main request:",
          e
        );
      }

      const response = await fetch(CREDENTIALS_API_URL, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Origin: window.location.origin,
        },
        credentials: "omit", // Do not send cookies
        mode: "cors", // Explicitly indicate CORS
      });

      console.log("Response status:", response.status);
      this.logHeaders(response.headers, "Response headers");

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Error response body:", errorText);
        throw new Error(
          `Failed to get AWS credentials: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      // Parse the JSON response, with robust error handling
      let data: CredentialsResponse;
      try {
        const responseText = await response.text();
        console.log("Raw response:", responseText.substring(0, 100) + "...");
        data = JSON.parse(responseText) as CredentialsResponse;
      } catch (e) {
        console.error("Error parsing JSON response:", e);
        throw new Error("Invalid response format from credentials service");
      }

      // Validate the response structure
      if (
        !data.credentials ||
        !data.credentials.accessKeyId ||
        !data.credentials.secretAccessKey
      ) {
        console.error(
          "Invalid credentials format received:",
          JSON.stringify(data, null, 2)
        );
        throw new Error("Received invalid credentials format from the server");
      }

      console.log(
        "Successfully received credentials with expiration:",
        data.credentials.expiration
      );

      // Store credentials
      this.credentials = data.credentials;
      this.credentialsExpiry = new Date(data.credentials.expiration);

      // Store in localStorage for other components
      localStorage.setItem("dna_bucket_name", data.bucketName);
      localStorage.setItem("dna_region", data.region);
      localStorage.setItem("dna_user_info", JSON.stringify(data.userInfo));

      return data;
    } catch (error) {
      console.error("Error fetching AWS credentials:", error);
      // Clear any stale credentials
      this.credentials = null;
      this.credentialsExpiry = null;
      throw error;
    }
  }
}

export default new AuthService();
