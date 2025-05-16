# MobileSD Project File Structure

This document outlines the main files and directories in the MobileSD project.

## Root Directory

*   `.git/`: Git repository data.
*   `data/`: Persistent data directory (mapped volume in Docker). Contains `servers.json` and the SQLite database `mobilesd_jobs.sqlite` for job queue management.
*   `docs/`: Project documentation (including this file).
    *   `Pinokio_Forge_API Guide.txt`: Reference documentation for Forge API integration.
    *   `Stable Diffusion Image Save API_.txt`: Documentation on image saving functionality.
    *   `FILES.MD` (This file): Project file structure overview.
    *   `API.md`: API endpoint documentation and request/response examples.
    *   `PLAN.md`: Comprehensive project plan with phased approach and architecture details.
*   `models/`: Placeholder/example for model files (managed by Forge itself).
*   `node_modules/`: Node.js dependencies (installed via `npm install`).
*   `outputs/`: Directory for saved output images from Forge generations.
*   `public/`: Static frontend files served by Express. Contains HTML, CSS, and JavaScript files for the web UI.
*   `routes/`: Express route definitions (API endpoints).
    *   `servers.js`: API endpoints for managing Forge server configurations.
    *   `resources.js`: API endpoints for listing checkpoints and LoRAs.
    *   `civitai.js`: API endpoints for Civitai integration (searching and downloading models).
    *   `models.js`: API endpoints for managing models, including listing models with metadata, serving preview images, and refreshing Civitai metadata.
    *   `generation.js`: API endpoints for image generation and job status retrieval.
*   `services/`: Backend services for job processing and monitoring.
    *   `gradioJobDispatcher.js`: Service responsible for processing pending jobs from the SQLite database queue. It connects to the Forge server using the Gradio API (`/queue/join`), sets the checkpoint model, submits generation tasks, and updates job status in the database. Includes path normalization for cross-platform compatibility (forward/backslashes).
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
    *   `pngMetadataReader.js`: Utility for reading metadata from PNG images.
    *   `modelDatabase.js`: Manages the model database for efficient checkpoint lookup and path normalization. Maintains a cache of checkpoint paths with different path formats for better matching.
    *   `clearQueue.js`: Utility script to clear all pending and processing jobs in the queue.
    *   `resetApp.js`: Emergency reset script to completely clear application state and restart cleanly.
*   `app.js`: Main Node.js/Express application entry point. Sets up server, middleware, routes, and starts services.
*   `deploy-mobilesd-to-unraid.sh`: Script to build, transfer, and deploy the Docker image to the Unraid server. Includes functionality to clear the job queue.
*   `docker-compose.yml`: Docker Compose configuration for local development/build.
*   `Dockerfile`: Instructions for building the MobileSD application Docker image.
*   `.gitignore`: Specifies intentionally untracked files that Git should ignore.
*   `package.json`: Defines project metadata and dependencies.
*   `package-lock.json`: Records exact versions of dependencies.
*   `test_api.py`: Python script for testing API endpoints.

## Architecture Overview

MobileSD uses a single-container Docker approach with Node.js/Express serving both the API and static frontend assets. The core functionality includes:

1. **Dynamic Server Configuration**: Manage multiple Forge server connections through a user-friendly interface.
2. **Job Queue System**: SQLite-based persistent job queue that operates independently of the browser.
3. **Resource Management**: Scan and access checkpoints and LoRAs from configured paths.
4. **Asynchronous Processing**: Background job processing using Forge's Gradio API.
5. **Image Saving**: Automatically save generated images to a configurable directory.
6. **Civitai Integration**: Search and download models directly from Civitai with the following features:
   - Rate-limited API requests to prevent excessive calls
   - Compatible metadata storage with Forge extension format
   - Multiple preview image formats (both standard JPG and Forge's .preview.png)
   - Model identification via both name and hash matching
   - Display of Civitai IDs, links, and metadata in model details
7. **Model Database**: SQLite-based model database with efficient lookup and path normalization for cross-platform compatibility.

The system uses a three-pronged approach for generation:
1. Set the checkpoint model using the `/sdapi/v1/options` endpoint
2. Submit a generation task using the Gradio API (fn_index: 257)
3. Also attempt a direct txt2img API call for compatibility

For checkpoint handling, the system:
1. Normalizes path separators (converting forward slashes to backslashes for Windows-based Forge instances)
2. Maintains a model database for efficient model lookup across different path formats
3. Uses both the Gradio template's checkpoint field (index 17) and override_settings in the payload

This architecture provides robust cross-platform compatibility and allows MobileSD to queue and process image generations even if the user closes their browser.
