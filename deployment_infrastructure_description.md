## Deployment and Infrastructure Description

The application is deployed entirely on **Amazon Web Services (AWS)**, utilizing a combination of its managed services to achieve scalability, reliability, and global reach. The infrastructure supports a serverless backend and a statically hosted frontend.

**Key AWS Services and Infrastructure Components:**

1.  **Frontend Deployment:**
    *   **AWS S3 (Simple Storage Service):** The compiled static assets of the React frontend (HTML, CSS, JavaScript, images) are hosted in an S3 bucket configured for static website hosting.
    *   **Amazon CloudFront:** CloudFront is used as a Content Delivery Network (CDN) to distribute the frontend application globally. It caches the static assets at edge locations closer to users, significantly reducing latency and improving load times.
    *   **Amazon Route 53:** (Implied) For custom domain name management, Route 53 is likely used to route traffic to the CloudFront distribution.

2.  **Backend Infrastructure:**
    *   **AWS Lambda:** The backend logic is implemented as serverless functions running on AWS Lambda. These Node.js functions handle tasks such as API requests, data processing, and authorization.
    *   **Amazon API Gateway:** API Gateway serves as the entry point for all backend operations. It creates and manages RESTful APIs that trigger the appropriate Lambda functions based on HTTP requests. It also integrates with the custom Lambda authorizer for securing the endpoints.

**Deployment Automation:**

The deployment process leverages automation to ensure consistency and efficiency:

1.  **Continuous Integration/Continuous Deployment (CI/CD):**
    *   **GitHub Actions:** The presence of a `.github/workflows/gh-pages.yml` file indicates the use of GitHub Actions for CI/CD. This is likely configured to automate the build and deployment process of the frontend application, especially when changes are pushed to the repository (e.g., deploying to the S3 bucket for static hosting, potentially via the `gh-pages` branch or similar mechanism).

2.  **Deployment Scripts:**
    *   **Frontend Deployment Script:** The `deploy-react-app.sh` script is likely used to build the React application and deploy its static files to AWS S3, possibly also handling CloudFront cache invalidation. This script can be run manually or as part of the CI/CD pipeline.
    *   **Backend Deployment Scripts:** Scripts within the `lambda/scripts/` directory, such as `deploy-lambda-all.sh`, are used to package and deploy the AWS Lambda functions and their dependencies. These scripts might also handle the configuration of API Gateway resources or other backend components.

This infrastructure setup allows for a decoupled architecture where the frontend and backend can be developed, deployed, and scaled independently. The use of serverless technologies and managed services minimizes operational overhead.
