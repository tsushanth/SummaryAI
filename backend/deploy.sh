#!/bin/bash

# SummaryAI Backend Deploy Script
# Deploys to Google Cloud Run

set -e

# Configuration
PROJECT_ID="summarizerproxy"
SERVICE_NAME="summary-ai-backend"
REGION="us-central1"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  SummaryAI Backend Deploy Script${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Ensure we're in the correct directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Verify we're in the SummaryAI backend directory
if [[ ! -f "package.json" ]]; then
    echo -e "${RED}Error: package.json not found. Are you in the backend directory?${NC}"
    exit 1
fi

# Check if this is the correct project by looking at package.json name
PACKAGE_NAME=$(grep -o '"name": *"[^"]*"' package.json | sed 's/"name": *"\([^"]*\)"/\1/')
if [[ "$PACKAGE_NAME" != "summary-ai-backend" ]]; then
    echo -e "${RED}Error: This doesn't appear to be the SummaryAI backend.${NC}"
    echo -e "${RED}Package name: $PACKAGE_NAME${NC}"
    exit 1
fi

echo -e "${YELLOW}Project:${NC} $PROJECT_ID"
echo -e "${YELLOW}Service:${NC} $SERVICE_NAME"
echo -e "${YELLOW}Region:${NC} $REGION"
echo ""

# Build TypeScript
echo -e "${YELLOW}Building TypeScript...${NC}"
npm run build
echo -e "${GREEN}Build complete!${NC}"
echo ""

# Deploy to Cloud Run
echo -e "${YELLOW}Deploying to Cloud Run...${NC}"
gcloud run deploy "$SERVICE_NAME" \
    --source . \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --allow-unauthenticated

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Deployment Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${YELLOW}Service URL:${NC} https://$SERVICE_NAME-917362189743.$REGION.run.app"
