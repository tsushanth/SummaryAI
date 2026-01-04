#!/bin/bash

# Meeting Mind Web Deploy Script
# Deploys to Google Cloud Run

set -e

# Configuration
PROJECT_ID="summarizerproxy"
SERVICE_NAME="meeting-mind-web"
REGION="us-central1"
REPO_NAME="meeting-mind"

# Environment variables
NEXT_PUBLIC_SUPABASE_URL="https://mlofjzlmncgnhxbiuemf.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1sb2ZqemxtbmNnbmh4Yml1ZW1mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcyOTU1NjAsImV4cCI6MjA4Mjg3MTU2MH0.fUxgMcu1BNrsYneN5vSMFWxsv-rWIygCx-xn-Vmr0Ec"
NEXT_PUBLIC_GOOGLE_CLIENT_ID="753424767416-54viqmpd45g10oohm7vug13o8tdhb8qp.apps.googleusercontent.com"
NEXT_PUBLIC_API_URL="https://summary-ai-backend-917362189743.us-central1.run.app/v1"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Meeting Mind Web Deploy Script${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Ensure we're in the correct directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Verify we're in the web directory
if [[ ! -f "package.json" ]]; then
    echo -e "${RED}Error: package.json not found. Are you in the web directory?${NC}"
    exit 1
fi

echo -e "${YELLOW}Project:${NC} $PROJECT_ID"
echo -e "${YELLOW}Service:${NC} $SERVICE_NAME"
echo -e "${YELLOW}Region:${NC} $REGION"
echo ""

# Create Artifact Registry repository if it doesn't exist
echo -e "${YELLOW}Ensuring Artifact Registry repository exists...${NC}"
gcloud artifacts repositories describe "$REPO_NAME" \
    --project="$PROJECT_ID" \
    --location="$REGION" 2>/dev/null || \
gcloud artifacts repositories create "$REPO_NAME" \
    --repository-format=docker \
    --location="$REGION" \
    --project="$PROJECT_ID"

# Build the Docker image
echo -e "${YELLOW}Building Docker image...${NC}"
IMAGE_TAG="$REGION-docker.pkg.dev/$PROJECT_ID/$REPO_NAME/$SERVICE_NAME:latest"

docker build \
    --platform linux/amd64 \
    --build-arg NEXT_PUBLIC_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" \
    --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$NEXT_PUBLIC_SUPABASE_ANON_KEY" \
    --build-arg NEXT_PUBLIC_GOOGLE_CLIENT_ID="$NEXT_PUBLIC_GOOGLE_CLIENT_ID" \
    --build-arg NEXT_PUBLIC_API_URL="$NEXT_PUBLIC_API_URL" \
    -t "$IMAGE_TAG" \
    .

echo -e "${GREEN}Build complete!${NC}"
echo ""

# Configure Docker for Artifact Registry
echo -e "${YELLOW}Configuring Docker authentication...${NC}"
gcloud auth configure-docker "$REGION-docker.pkg.dev" --quiet

# Push the image
echo -e "${YELLOW}Pushing image to Artifact Registry...${NC}"
docker push "$IMAGE_TAG"

echo -e "${GREEN}Push complete!${NC}"
echo ""

# Deploy to Cloud Run
echo -e "${YELLOW}Deploying to Cloud Run...${NC}"
gcloud run deploy "$SERVICE_NAME" \
    --image "$IMAGE_TAG" \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --platform managed \
    --allow-unauthenticated \
    --memory 512Mi \
    --cpu 1 \
    --min-instances 0 \
    --max-instances 10 \
    --port 8080

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Deployment Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Get the service URL
SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --format 'value(status.url)')

echo -e "${YELLOW}Service URL:${NC} $SERVICE_URL"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Add '$SERVICE_URL/auth/callback' to Google OAuth redirect URIs"
echo "2. Add '$SERVICE_URL' to Supabase Authentication > URL Configuration > Redirect URLs"
