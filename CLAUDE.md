# CCPA Uploader Development Guidelines

## Commands
- **Frontend Dev**: `npm start`
- **Build Frontend**: `npm run build`
- **Deploy Frontend**: `npm run deploy`
- **Run Tests**: `npm test`
- **Build Lambdas**: `cd lambda && ./scripts/build-lambdas.sh`
- **Deploy Lambda**: `cd lambda && ./scripts/deploy-lambda-function.sh <function-name>`
- **Deploy All Lambdas**: `cd lambda && ./scripts/deploy.sh all`

## Code Style
- **Components**: Use functional components with TypeScript interfaces
- **Naming**: PascalCase for components/interfaces, camelCase for functions
- **Files**: Components in separate files with matching CSS (e.g., `ComponentName.tsx`, `ComponentName.css`)
- **Imports**: Group external dependencies first, then internal imports
- **Error Handling**: Use try/catch with specific error messages
- **Types**: Define interfaces for props, state, and service responses
- **AWS Integration**: Check credential expiration, include error handling for S3 operations
- **Organization**: Follow existing directory structure for components and services

Maintain consistent casing, use TypeScript strict mode, and follow existing patterns when adding new code.