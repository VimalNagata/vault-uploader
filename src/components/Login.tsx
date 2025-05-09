import React, { useState } from "react";
import { useGoogleLogin, CodeResponse, TokenResponse } from "@react-oauth/google";
import AuthService from "../services/AuthService";
import "./Login.css";

interface UserInfo {
  email: string;
  name?: string;
  picture?: string;
  given_name?: string;
  family_name?: string;
}

interface LoginProps {
  onLogin: (username: string) => void;
}

const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Handle successful authentication and user info retrieval
  const handleGoogleSuccess = async (accessToken: string, idToken: string | null) => {
    try {
      // Get user info from Google
      const userInfoResponse = await fetch(
        "https://www.googleapis.com/oauth2/v3/userinfo",
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (!userInfoResponse.ok) {
        throw new Error(
          `Failed to fetch user info: ${userInfoResponse.status}`
        );
      }

      const userInfo: UserInfo = await userInfoResponse.json();

      if (!userInfo.email) {
        throw new Error("No email found in Google profile");
      }

      // Store user info in localStorage
      localStorage.setItem(
        "dna_user_info",
        JSON.stringify({
          ...userInfo,
          provider: "google",
        })
      );

      // Store Google access token in AuthService for API calls
      // The token we use here is the access token, since that's what we have
      // Our authorizer Lambda is designed to work with both ID and access tokens
      AuthService.setGoogleToken(accessToken);

      // Login with email as username
      onLogin(userInfo.email);
    } catch (err) {
      console.error("Error processing Google login:", err);
      setError("Failed to get user information. Please try again.");
      setIsLoading(false);
    }
  };

  // Configure Google login hook to get access token
  const login = useGoogleLogin({
    onSuccess: async (codeResponse) => {
      try {
        // Get the access token from the response by casting to the right type
        const tokenResponse = codeResponse as unknown as TokenResponse;
        const accessToken = tokenResponse.access_token;

        if (!accessToken) {
          setError("Failed to receive access token from Google");
          setIsLoading(false);
          return;
        }

        // Get token info to verify token and get additional information
        const tokenInfoResponse = await fetch(
          `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${accessToken}`
        );

        if (!tokenInfoResponse.ok) {
          throw new Error(
            `Failed to get token info: ${tokenInfoResponse.status}`
          );
        }

        const tokenInfo = await tokenInfoResponse.json();
        console.log("Token info:", tokenInfo);

        // Pass the accessToken as both values
        // Our Lambda authorizer can handle access tokens correctly
        handleGoogleSuccess(accessToken, null);
      } catch (err) {
        console.error("Error processing Google token:", err);
        setError("Failed to process Google authentication. Please try again.");
        setIsLoading(false);
      }
    },
    onError: (error) => {
      console.error("Google login error:", error);
      setError("Google authentication failed. Please try again.");
      setIsLoading(false);
    },
    onNonOAuthError: (error) => {
      console.error("Non-OAuth error:", error);
      setError("Authentication error: " + error.type);
      setIsLoading(false);
    },
    scope: "email profile",
    flow: "implicit", // Implicit flow is required for single-page applications
  });

  // Check if Google Client ID is configured
  const isGoogleConfigured = !!process.env.REACT_APP_GOOGLE_CLIENT_ID;

  // Handle the login button click
  const handleLoginClick = () => {
    if (!isGoogleConfigured) {
      setError(
        "Google OAuth is not properly configured. Please add a valid REACT_APP_GOOGLE_CLIENT_ID to your .env file."
      );
      return;
    }

    setIsLoading(true);
    setError(null);
    login();
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <h2>Dee-en-eh Data Vault</h2>
        <p className="login-subtitle">
          Sign in to securely access your personal data vault
        </p>

        <div className="login-methods">
          <div className="social-login">
            <button
              onClick={handleLoginClick}
              disabled={isLoading}
              className="google-signin-button"
            >
              <svg
                width="18"
                height="18"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 48 48"
              >
                <path
                  fill="#EA4335"
                  d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                />
                <path
                  fill="#4285F4"
                  d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                />
                <path
                  fill="#FBBC05"
                  d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                />
                <path
                  fill="#34A853"
                  d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                />
              </svg>
              Sign in with Google
            </button>
          </div>

          {!isGoogleConfigured && (
            <div className="setup-warning">
              <h3>Setup Required</h3>
              <p>
                Google OAuth is not configured. Set the
                REACT_APP_GOOGLE_CLIENT_ID in your .env file:
              </p>
              <ol>
                <li>
                  Create a Google OAuth Client ID at{" "}
                  <a
                    href="https://console.cloud.google.com/apis/credentials"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Google Cloud Console
                  </a>
                </li>
                <li>
                  Add <code>http://localhost:3000</code> as an authorized
                  JavaScript origin
                </li>
                <li>
                  Add the Client ID to your .env file as{" "}
                  <code>REACT_APP_GOOGLE_CLIENT_ID=your_client_id</code>
                </li>
                <li>Restart the development server</li>
              </ol>
            </div>
          )}

          {isLoading && <div className="login-loading">Authenticating...</div>}
          {error && <div className="login-error">{error}</div>}

          <div className="login-help">
            <p>
              Need help? Contact{" "}
              <a href="mailto:support@example.com">support@example.com</a>
            </p>
            <p className="login-note">
              This is a secure vault for storing and managing your personal
              data.
            </p>
            <p className="login-note">
              Sign in with your Google account to get started.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;