# MobileSD Project File Structure

This document outlines the main files and directories in the MobileSD project.

## Root Directory

*   `.git/`: Git repository data.
*   `data/`: Persistent data directory (mapped volume in Docker). Contains `servers.json`, `job_queue.json`, and potentially saved images if configured differently later.
*   `docs/`: Project documentation (including this file).
    *   `Programmatic Remote Storage.txt`
    *   `Stable Diffusion Image Save API_.txt`
    *   `FILES.MD` (This file)
*   `models/`: Placeholder/example for model files (likely managed by Forge itself).
*   `node_modules/`: Node.js dependencies (installed via `npm install`).
*   `outputs/`: Placeholder/example for output files (likely managed by Forge itself).
*   `public/`: Static frontend files served by Express. Contains HTML, CSS, and potentially JavaScript files (needs investigation).
*   `routes/`: Express route definitions (e.g., API endpoints).
*   `services/`: Backend services (e.g., job dispatcher).
    *   `dispatcher.js`: Service responsible for periodically checking the job queue (`data/job_queue.json`) for pending image generation requests. It retrieves server configurations, verifies the requested checkpoint model exists on the target Forge server (using `verifyCheckpointExists`), constructs the payload for Forge's `/sdapi/v1/txt2img` API (including handling `override_settings` for checkpoints and converting seeds), sends the request synchronously, processes the response, and updates the job status in the queue. Contains the `startDispatcher` and `stopDispatcher` functions used by `app.js`.
*   `utils/`: Utility functions shared across the backend.
    *   `configHelpers.js`: Helpers for reading/writing `servers.json` and scanning model directories.
    *   `jobQueueHelpers.js`: Helper functions for interacting with the `job_queue.json` file. Provides functions like `readJobQueue`, `writeJobQueue`, `addJobToQueue`, `updateJobInQueue`, and the recently added `getJobById`.
*   `app.js`: Main Node.js/Express application entry point. Sets up server, middleware, routes, and starts services.
*   `deploy-mobilesd-to-unraid.sh`: Script to build, transfer, and deploy the Docker image to the Unraid server.
*   `docker-compose.yml`: Docker Compose configuration for local development/build.
*   `Dockerfile`: Instructions for building the MobileSD application Docker image.
*   `.gitignore`: Specifies intentionally untracked files that Git should ignore.
*   `package.json`: Defines project metadata and dependencies.
*   `package-lock.json`: Records exact versions of dependencies.
*   `test_api.py`: Python script for testing API endpoints.

*(Note: The contents of directories like `public/`, `routes/`, `utils/` might need further detail as we explore them.)*
