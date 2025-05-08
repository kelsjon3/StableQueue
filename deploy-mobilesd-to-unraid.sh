#!/bin/bash

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# --- Configuration - Adjust these to your Unraid setup ---
UNRAID_HOST="${UNRAID_HOST:-"192.168.73.124"}" # Default from Billado, overridden by .env
UNRAID_USER="${UNRAID_USER:-"root"}"       # Default from Billado, overridden by .env
APP_NAME="mobilesd"
IMAGE_NAME="mobilesd-app" # Should match 'image:' in docker-compose.yml
IMAGE_TAG="latest"

# Base directory for the app on Unraid (e.g., under appdata)
UNRAID_APP_BASE_DIR="/mnt/user/appdata" # Common Unraid appdata path
UNRAID_APP_DIR="${UNRAID_APP_BASE_DIR}/${APP_NAME}"

# Paths on Unraid for persistent data - these will be used in the docker-compose on Unraid
# Ensure these parent directories exist on Unraid or are created by Unraid's appdata system
UNRAID_CONFIG_DATA_PATH="${UNRAID_APP_DIR}/data" # For MobileSD's own config like servers.json


# !!! CRITICAL: REVIEW AND SET THESE PATHS MANUALLY AFTER THIS EDIT !!!
# Point these to your actual master model library and desired saves location on Unraid.
# Assumes a base data path is set. Using Forge-like structure.
UNRAID_DATA_PATH="/mnt/user/Stable_Diffusion_Data" # Your master data location
UNRAID_SAVES_PATH="${UNRAID_DATA_PATH}/outputs/MobileSD"       # Subfolder within outputs for clarity
UNRAID_LORAS_PATH="${UNRAID_DATA_PATH}/models/Lora"           # Path to master LoRAs
UNRAID_CHECKPOINTS_PATH="${UNRAID_DATA_PATH}/models/Stable-diffusion" # Path to master Checkpoints

UNRAID_HOST_PORT="8083" # The port you want to access MobileSD on Unraid
# --- End Configuration ---

set -e # Exit immediately if a command exits with a non-zero status.

# Source .env file if it exists for UNRAID_HOST, UNRAID_USER etc.
if [ -f .env ]; then
    echo -e "${YELLOW}Sourcing environment variables from .env file... ${NC}"
    export $(grep -v '^#' .env | xargs)
fi

# Check if we are in the project root (where docker-compose.yml is)
if [ ! -f "docker-compose.yml" ]; then
    echo -e "${RED}Error: docker-compose.yml not found! ${NC}"
    echo "Please run this script from the project root directory where docker-compose.yml is located."
    exit 1
fi

echo -e "${GREEN}Starting deployment of ${APP_NAME} to Unraid server: ${UNRAID_HOST}...${NC}"

echo -e "${YELLOW}Step 1: Building Docker image locally (${IMAGE_NAME}:${IMAGE_TAG})...${NC}"
docker-compose build mobilesd # 'mobilesd' is the service name in docker-compose.yml
if [ $? -ne 0 ]; then echo -e "${RED}Docker build failed! Aborting.${NC}"; exit 1; fi

echo -e "${YELLOW}Step 2: Saving Docker image to a .tar file...${NC}"
TAR_FILENAME="${IMAGE_NAME}_${IMAGE_TAG}.tar"
docker save "${IMAGE_NAME}:${IMAGE_TAG}" > "${TAR_FILENAME}"
if [ $? -ne 0 ]; then echo -e "${RED}Docker save failed! Aborting.${NC}"; rm -f "${TAR_FILENAME}"; exit 1; fi

echo -e "${YELLOW}Step 3: Preparing directories and copying files to Unraid server...${NC}"
ssh "${UNRAID_USER}@${UNRAID_HOST}" "mkdir -p ${UNRAID_APP_DIR}"
scp "${TAR_FILENAME}" "${UNRAID_USER}@${UNRAID_HOST}:${UNRAID_APP_DIR}/"
if [ $? -ne 0 ]; then echo -e "${RED}SCP of .tar file failed! Aborting.${NC}"; rm -f "${TAR_FILENAME}"; exit 1; fi

echo -e "${YELLOW}Step 4: Deploying on Unraid server...${NC}"
ssh "${UNRAID_USER}@${UNRAID_HOST}" "bash -s" << EOF_UNRAID_SCRIPT
    set -e
    echo "--- Running on Unraid: $(hostname) ---"
    cd "${UNRAID_APP_DIR}"

    echo "Loading Docker image from .tar file..."
    docker load < "${TAR_FILENAME}"

    echo "Creating docker-compose.unraid.yml..."
    # Create the docker-compose file on Unraid
cat > docker-compose.unraid.yml << 'EOF_COMPOSE'
version: '3.8'
services:
  ${APP_NAME}:
    image: ${IMAGE_NAME}:${IMAGE_TAG}
    container_name: ${APP_NAME}
    ports:
      - "${UNRAID_HOST_PORT}:3000"
    volumes:
      - ${UNRAID_CONFIG_DATA_PATH}:/usr/src/app/data
      # Updated volume paths for Unraid deployment
      - ${UNRAID_SAVES_PATH}:/app/outputs
      - ${UNRAID_LORAS_PATH}:/app/models/Lora
      - ${UNRAID_CHECKPOINTS_PATH}:/app/models/Stable-diffusion
    environment:
      - PORT=3000
      - CONFIG_DATA_PATH=/usr/src/app/data
      # Updated environment variables for container paths
      - STABLE_DIFFUSION_SAVE_PATH=/app/outputs
      - LORA_PATH=/app/models/Lora
      - CHECKPOINT_PATH=/app/models/Stable-diffusion
      - NODE_ENV=production
    restart: unless-stopped
EOF_COMPOSE

    echo "Stopping and removing existing ${APP_NAME} services (if any)..."
    docker-compose -f docker-compose.unraid.yml down || true # Allow to fail if not exists

    echo "Starting ${APP_NAME} service using docker-compose..."
    docker-compose -f docker-compose.unraid.yml up -d

    echo "Cleaning up .tar file on Unraid..."
    rm "${TAR_FILENAME}"
    echo "--- Unraid script finished ---"
EOF_UNRAID_SCRIPT
if [ $? -ne 0 ]; then echo -e "${RED}Unraid deployment script failed! Aborting.${NC}"; rm -f "${TAR_FILENAME}"; exit 1; fi

echo -e "${YELLOW}Step 5: Cleaning up local .tar file...${NC}"
rm "${TAR_FILENAME}"

echo -e "${GREEN}${APP_NAME} deployment to Unraid completed successfully!${NC}"
echo -e "${YELLOW}You should be able to access it at: http://${UNRAID_HOST}:${UNRAID_HOST_PORT}${NC}" 