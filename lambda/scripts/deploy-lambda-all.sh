./deploy.sh data-preprocessor
./deploy-lambda-function.sh data-preprocessor

./deploy.sh categorize-user-data
./deploy-lambda-function.sh categorize-user-data

./deploy.sh persona-builder
./deploy-lambda-function.sh persona-builder

./deploy.sh get-user-data-metrics
./deploy-lambda-function.sh get-user-data-metrics

./deploy.sh prompt-manager
./deploy-lambda-function.sh prompt-manager