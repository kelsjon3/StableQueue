# Project Plan: Node.js Express API Intermediary for Stable Diffusion Forge

## I. Project Initialization & Configuration:

1.  **Base:**
    *   Initialize a Node.js project with Express.js.
    *   Include `axios` for making HTTP requests to Forge.
    *   The server should listen on a port defined by `process.env.PORT` (default to `3000` if not set).

2.  **Configuration File (`servers-config.json`):**
    *   The application must load its Forge server configurations from a `servers-config.json` file at startup.
    *   This file will contain an array of server objects. Each object represents a configurable Forge instance and should have the following fields:
        *   `alias`: (string, unique identifier, e.g., "windows_forge_instance", "linux_dev_forge") - Used by the client to select this server.
        *   `apiUrl`: (string, base URL of the Forge API, e.g., "http://192.168.1.100:7860")
        *   `auth`: (object, optional, for Basic Auth, e.g., `{ "username": "user", "password": "password" }`).
    *   Provide a sample `servers-config.json`.

3.  **File Save Path (Environment Variable):**
    *   The application must read a `STABLE_DIFFUSION_SAVE_PATH` environment variable.
    *   Ensure the application checks if this path is writable.

## II. API Endpoints:

1.  **`POST /api/v1/generate` (Image Generation):**
    *   **Request Body:** `server_alias`, `positive_prompt`, `negative_prompt`, `seed`, `loras`, `sampler_name`, `steps`, `cfg_scale`, `width`, `height`, `save_image_to_server_path`, `return_image_data`.
    *   **Processing:**
        1.  Validate input.
        2.  Construct Forge API payload (`/sdapi/v1/txt2img`), append LoRAs to prompt.
        3.  Make async POST request to Forge with authentication.
        4.  Process Forge response:
            *   Save image if requested and path is valid.
            *   Return JSON response (success with image details or error).

2.  **`GET /api/v1/progress` (Generation Progress):**
    *   **Query Parameters:** `server_alias`.
    *   **Processing:**
        1.  Look up server configuration.
        2.  Make async GET request to Forge (`/sdapi/v1/progress`) with authentication.
        3.  Relay Forge JSON response to client.
        4.  Handle errors.

## III. General Requirements:

1.  **Error Handling:** Robust try-catch, meaningful JSON errors, appropriate HTTP status codes.
2.  **Logging:** Console logging for requests, Forge interactions, image saving, errors.
3.  **Code Structure:** Logical modules (e.g., `routes/`, `controllers/` or `services/`, `config.js`). Use `express.Router()`. Well-commented code.
4.  **Dockerfile:**
    *   Use Node.js slim image.
    *   Copy `package.json`, `package-lock.json`, install dependencies.
    *   Copy source code and `servers-config.json` (or mount as volume).
    *   Expose port.
    *   Set `CMD` to run the application.
    *   Note environment variables (`STABLE_DIFFUSION_SAVE_PATH`, `PORT`).

## IV. Immediate Steps (as per user request):

1.  **Create `docs/PLAN.md` (This document).** (Completed)
2.  **User to handle GitHub synchronization.**
3.  **User to provide path to a reference Node.js/Express project for Docker setup.**
4.  **Draft `Dockerfile` for this project based on reference and prompt.**
5.  **Create a Docker update script (e.g., `update_docker.sh`).**

## V. Development Workflow:

1.  Project Initialization and Core Setup (`app.js`, `package.json`, dependencies).
2.  Configuration Management (`servers-config.json` loading, `STABLE_DIFFUSION_SAVE_PATH` handling).
3.  API Endpoints Implementation (`/api/v1/generate`, `/api/v1/progress`).
4.  Integrate General Requirements (Error Handling, Logging, Code Structure).
5.  Dockerfile Creation.
6.  Review and Refinement. 