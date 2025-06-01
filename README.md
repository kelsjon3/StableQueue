# StableQueue

A job queuing system for Stable Diffusion and other AI tools, designed to work seamlessly with A1111 WebUI Forge and other Stable Diffusion interfaces.

## Overview

StableQueue provides a robust, browser-independent queuing system for managing multiple image generation jobs. It acts as an intermediary between client applications (like the Forge extension) and Stable Diffusion servers, providing reliable job management, progress tracking, and result handling.

## Core Application Flow

1. **Application starts** - Works immediately, no setup required
2. **Add servers** - Connect to your Stable Diffusion instances as needed
3. **Generate API keys** - Create them when needed for external applications
4. **Manage jobs** - Queue, monitor, and view results
5. **View images** - See generated content in the frontend gallery

## Key Features

- **Persistent Job Queue**: Jobs survive server restarts and browser disconnects
- **Multi-Server Support**: Manage multiple Stable Diffusion instances
- **Web UI**: Administrative interface for managing servers, jobs, and API keys
- **Extension Support**: Works with A1111 WebUI Forge extension
- **API Access**: Full REST API for external applications
- **Progress Tracking**: Real-time job status and progress updates
- **Image Management**: Automatic image saving and gallery viewing

## Quick Start

### Docker Deployment (Recommended)

1. **Clone the repository**:
   ```bash
   git clone https://github.com/your-username/StableQueue.git
   cd StableQueue
   ```

2. **Configure environment** (optional):
   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

3. **Start with Docker Compose**:
   ```bash
   docker-compose up -d
   ```

4. **Access the web interface**:
   - Open http://localhost:8083 in your browser

### Manual Installation

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Start the server**:
   ```bash
   npm start
   ```

3. **Access the web interface**:
   - Open http://localhost:3000 in your browser

## Configuration

### Adding Stable Diffusion Servers

1. Navigate to the **Server Setup** tab in the web UI
2. Click **Add Server**
3. Enter server details:
   - **Name**: Friendly name for the server
   - **URL**: Base URL (e.g., `http://192.168.1.100:7860`)
   - **Username/Password**: If authentication is required

### API Key Management

API keys are used by external applications to authenticate with StableQueue:

1. Navigate to the **API Keys** tab in the web UI
2. Click **Create New Key**
3. Enter a name and description
4. Copy the generated key and secret
5. Use these credentials in external applications

**Important**: The web UI has administrative access and doesn't require API keys. API keys are FOR external applications like the Forge extension.

## API Documentation

### Authentication

External applications must authenticate using API keys:

```bash
# Using X-API-Key and X-API-Secret headers
curl -H "X-API-Key: mk_your_api_key" \
     -H "X-API-Secret: your_api_secret" \
     http://localhost:8083/api/v1/generate

# Or using Authorization header
curl -H "Authorization: Bearer $(echo -n 'api_key:api_secret' | base64)" \
     http://localhost:8083/api/v1/generate
```

### Job Submission

Submit image generation jobs:

```bash
curl -X POST http://localhost:8083/api/v1/generate \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your_api_key" \
  -H "X-API-Secret: your_api_secret" \
  -d '{
    "target_server_alias": "Laptop",
    "generation_params": {
      "positive_prompt": "a beautiful landscape",
      "negative_prompt": "ugly, blurry",
      "checkpoint_name": "model.safetensors",
      "width": 512,
      "height": 512,
      "steps": 20,
      "cfg_scale": 7,
      "sampler_name": "Euler"
    }
  }'
```

### Job Status

Check job status and retrieve results:

```bash
curl -H "X-API-Key: your_api_key" \
     -H "X-API-Secret: your_api_secret" \
     http://localhost:8083/api/v1/queue/jobs/JOB_ID/status
```

For complete API documentation, see [docs/API.md](docs/API.md).

## Forge Extension

StableQueue includes an extension for A1111 WebUI Forge that enables direct job submission from the Forge interface.

### Installation

1. In Forge WebUI, go to **Extensions** → **Install from URL**
2. Enter the repository URL: `https://github.com/your-username/StableQueue.git`
3. Click **Install**
4. Restart Forge WebUI

### Configuration

1. Go to **Settings** → **StableQueue**
2. Configure:
   - **Server URL**: Your StableQueue server (e.g., `http://192.168.1.100:8083`)
   - **API Key**: Key generated from StableQueue web UI
   - **API Secret**: Secret from StableQueue web UI

## Architecture

StableQueue consists of:

- **Node.js/Express Backend**: API server and job management
- **SQLite Database**: Persistent storage for jobs, servers, and API keys
- **Web Frontend**: Administrative interface (HTML/CSS/JavaScript)
- **Job Dispatcher**: Background service for job processing
- **Progress Monitor**: Real-time job status tracking

## Environment Variables

Key environment variables:

- `PORT`: Server port (default: 3000)
- `CONFIG_DATA_PATH`: Data directory path
- `STABLE_DIFFUSION_SAVE_PATH`: Image output directory
- `LORA_PATH`: LoRA models directory
- `CHECKPOINT_PATH`: Checkpoint models directory

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the ISC License - see the [LICENSE](LICENSE) file for details.

## Support

For issues and questions:

- Check the [documentation](docs/)
- Review [existing issues](https://github.com/your-username/StableQueue/issues)
- Create a new issue if needed

## Deployment Information

**Current Production Deployment**: 
- Server: Unraid at 192.168.73.124:8083
- Status: Active and operational
- Deployment Method: Docker container via deployment script 