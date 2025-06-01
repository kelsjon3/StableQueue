# StableQueue Project File Structure

This document outlines the main files and directories in the StableQueue project.

## Root Directory

*   `.git/`: Git repository data.
*   `data/`: Persistent data directory (mapped volume in Docker). Contains `servers.json` and the SQLite database `mobilesd_jobs.sqlite` for job queue management and API key storage.
*   `docs/`: Project documentation (including this file).
    *   `Pinokio_Forge_API Guide.txt`: Reference documentation for Forge API integration.
    *   `API.md`: API endpoint documentation and request/response examples.
    *   `EXTENSION_API.md`: API documentation specifically for extension developers.
    *   `API_IMPLEMENTATION_SUMMARY.md`: Comprehensive summary of API standardization work.
    *   `API_KEY_UI_SUMMARY.md`: Documentation of API key management UI implementation.
    *   `API_TESTING_SUMMARY.md`: Testing approach and coverage documentation.
    *   `PLAN.md`: Comprehensive project plan with phased approach and architecture details.
    *   `FILES.MD` (This file): Project file structure overview.
*   `middleware/`: Express middleware for cross-cutting concerns.
    *   `apiAuth.js`: API authentication middleware for validating API keys.
    *   `apiMiddleware.js`: CORS and other API-related middleware.
*   `models/`: Placeholder/example for model files (managed by Forge itself).
*   `node_modules/`: Node.js dependencies (installed via `npm install`).
*   `outputs/`: Directory for saved output images from Forge generations.
*   `public/`: Static frontend files served by Express. Contains HTML, CSS, and JavaScript files for the web UI.
    *   `js/apiKeyManager.js`: Client-side API key management functionality.
    *   `js/app.js`: Main application JavaScript with navigation and UI management.
    *   `css/style.css`: Application styling including API key management UI.
    *   `index.html`: Main web interface including API key management tab.
*   `routes/`: Express route definitions (API endpoints).
    *   `servers.js`: API endpoints for managing Forge server configurations (simplified without model root path).
    *   `apiKeys.js`: API endpoints for API key management (create, read, update, delete, setup).
    *   `resources.js`: API endpoints for listing checkpoints and LoRAs.
    *   `civitai.js`: API endpoints for Civitai integration (searching and downloading models).
    *   `models.js`: API endpoints for managing models, including listing models with metadata, serving preview images, and refreshing Civitai metadata.
    *   `generation.js`: API endpoints for image generation and job status retrieval.
    *   `v2Generation.js`: Standardized v2 API endpoints for extension support.
*   `services/`: Backend services for job processing and monitoring.
    *   `gradioJobDispatcher.js`: Service responsible for processing pending jobs from the SQLite database queue. Connects to Forge server using the Gradio API, sets checkpoint model, submits generation tasks, and updates job status. Uses consistent forward slash path handling (model root path functionality removed).
    *   `forgeJobMonitor.js`: Service that monitors active Forge jobs, implemented with:
        *   Server-Sent Events (SSE) connection to track job progress in real-time
        *   Active polling of the `/internal/progress` endpoint to supplement SSE events
        *   Comprehensive image preview extraction from multiple sources
        *   De-duplication logic to prevent multiple copies of the same image
        *   Advanced logging with directional indicators (FORGE→SERVER, SERVER→CLIENT)
        *   Artificial progress updates for improved UI responsiveness
        *   Automated image downloading and metadata extraction
        *   Multiple fallback strategies to ensure job completion
    *   `dispatcher.js`: Legacy service (deprecated) that used the synchronous Forge API approach.
*   `utils/`: Utility functions shared across the backend.
    *   `configHelpers.js`: Helpers for reading/writing `servers.json` and scanning model directories.
    *   `jobQueueHelpers.js`: Helper functions for interacting with the SQLite database. Provides functions like `addJob`, `getJobById`, `updateJob`, `findPendingJobs`, etc.
    *   `apiKeyManager.js`: Utility functions for API key management, validation, and database operations.
    *   `apiErrorHandler.js`: Standardized error handling for API endpoints.
    *   `apiConstants.js`: API-related constants and configuration values.
    *   `pngMetadataReader.js`: Utility for reading metadata from PNG images.
    *   `modelDatabase.js`: Manages the model database for efficient checkpoint lookup and path normalization. Maintains a cache of checkpoint paths with different path formats for better matching.
    *   `clearQueue.js`: Utility script to clear all pending and processing jobs in the queue.
    *   `resetApp.js`: Emergency reset script to completely clear application state and restart cleanly.
*   `tests/`: Testing infrastructure for API endpoints and functionality.
    *   `apiEndpoints.test.js`: Automated test suites for API functionality.
*   `scripts/`: Utility scripts for development and testing.
    *   `manualApiTests.js`: Interactive CLI testing script for manual API testing.
    *   `runApiTests.js`: Test runner for automated tests.
*   `app.js`: Main Node.js/Express application entry point. Sets up server, middleware, routes, and starts services. Includes CORS support and API key authentication setup.
*   `deploy-stablequeue-to-unraid.sh`: Script to build, transfer, and deploy the Docker image to the Unraid server. Includes functionality to clear the job queue.
*   `docker-compose.yml`: Docker Compose configuration for local development/build.
*   `Dockerfile`: Instructions for building the StableQueue application Docker image.
*   `.gitignore`: Specifies intentionally untracked files that Git should ignore.
*   `package.json`: Defines project metadata and dependencies.
*   `package-lock.json`: Records exact versions of dependencies.
*   `test_api.py`: Python script for testing API endpoints.

## Architecture Overview

StableQueue uses a single-container Docker approach with Node.js/Express serving both the API and static frontend assets. The core functionality includes:

1. **Dynamic Server Configuration**: Manage multiple Forge server connections through a user-friendly interface (simplified without model root path complexity).
2. **Job Queue System**: SQLite-based persistent job queue that operates independently of the browser.
3. **Resource Management**: Scan and access checkpoints and LoRAs from configured paths.
4. **Asynchronous Processing**: Background job processing using Forge's Gradio API.
5. **Image Saving**: Automatically save generated images to a configurable directory.
6. **API Key Management**: Complete system for creating, managing, and authenticating with API keys:
   - Web UI management interface (no authentication required)
   - First-time setup flow for initial key creation
   - Rate limiting and usage tracking
   - Secure key generation and validation
7. **CORS Support**: Cross-origin resource sharing for browser-based extensions:
   - Support for localhost ports (7860, 8080, 3000)
   - Proper preflight request handling
   - Secure communication between Forge UI and StableQueue
8. **Extension API Support**: Standardized v2 API endpoints designed for external applications:
   - Extension identification and tracking
   - Standardized error handling
   - Consistent response formats
9. **Civitai Integration**: Search and download models directly from Civitai with the following features:
   - Rate-limited API requests to prevent excessive calls
   - Compatible metadata storage with Forge extension format
   - Multiple preview image formats (both standard JPG and Forge's .preview.png)
   - Model identification via both name and hash matching
   - Display of Civitai IDs, links, and metadata in model details
10. **Model Database**: SQLite-based model database with efficient lookup and path normalization for cross-platform compatibility.

## Key Changes and Improvements

### Removed Features
- **Model Root Path**: Eliminated complex Windows/Linux path detection logic
- **API Key Tiers**: Simplified to single rate limit for all keys
- **Complex Authentication**: Web UI now operates without API key authentication

### Added Features
- **CORS Middleware**: Full cross-origin support for browser extensions
- **Setup Endpoints**: Special endpoints for first-time API key creation
- **Consistent Path Handling**: Simplified to use forward slashes consistently
- **Enhanced Error Handling**: Standardized error responses across all endpoints

The system uses a three-pronged approach for generation:
1. Set the checkpoint model using the `/sdapi/v1/options` endpoint
2. Submit a generation task using the Gradio API (fn_index: 257)
3. Also attempt a direct txt2img API call for compatibility

For checkpoint handling, the system:
1. Uses consistent forward slash separators (simplified from previous Windows/Linux detection)
2. Maintains a model database for efficient model lookup across different path formats
3. Uses both the Gradio template's checkpoint field (index 17) and override_settings in the payload

This architecture provides robust cross-platform compatibility and allows StableQueue to queue and process image generations even if the user closes their browser.
