# StableQueue

A robust job queuing system for Stable Diffusion and other AI tools, designed to work seamlessly with A1111 WebUI Forge and provide reliable, persistent job management.

## Overview

StableQueue acts as an intelligent intermediary between client applications and Stable Diffusion servers, providing persistent job queuing, multi-server management, and reliable result handling. The system is designed to be simple, reliable, and production-ready.

## 🚀 Current Status

**Production Deployment**: ✅ Active at Unraid Server (192.168.73.124:8083)  
**Version**: 1.0.0  
**Status**: Stable and operational  

## ✨ Key Features

- **Zero-Setup Start**: Works immediately after deployment - no complex setup required
- **Persistent Job Queue**: Jobs survive server restarts and network disconnections
- **Multi-Server Support**: Manage multiple Stable Diffusion instances simultaneously
- **Web Administrative UI**: Complete management interface (no authentication required for admin tasks)
- **Secure API Access**: Full REST API with dual authentication methods for external applications
- **Real-Time Progress**: Live job status updates and progress tracking
- **Automatic Image Management**: Built-in image saving and gallery viewing
- **Production-Ready**: Docker deployment with automated scripts

## 🎯 Application Flow

The application follows a simple, reliable pattern:

1. **Starts Immediately** → No setup wizards or complex initialization
2. **Add Servers** → Connect to your Stable Diffusion instances as needed
3. **Generate API Keys** → Create credentials for external applications (Forge extensions, etc.)
4. **Queue Jobs** → Submit image generation tasks through web UI or API
5. **Monitor Progress** → Track jobs in real-time with automatic updates
6. **View Results** → Access generated images through the built-in gallery

## 🐳 Quick Start with Docker (Recommended)

### For Unraid Deployment (Production)

```bash
# Clone the repository
git clone https://github.com/kelsjon3/StableQueue.git
cd StableQueue

# Configure your environment (recommended)
cp .env.example .env
# Edit .env with your UNRAID_HOST, CIVITAI_API_KEY, and other settings

# Deploy to Unraid server
./deploy-stablequeue-to-unraid.sh
```

The deployment script automatically:
- Builds the Docker image locally
- Transfers to your Unraid server
- Clears any stuck jobs from previous deployments
- Starts the container with proper volume mappings
- Preserves your data and configuration

### For Local Development

```bash
# Using Docker Compose
docker-compose up -d

# Or manual installation
npm install
npm start
```

Access the web interface at `http://localhost:8083` (or your configured port).

## 🔧 Configuration

### Server Management

1. Navigate to **Server Setup** tab in the web UI
2. Click **Add Server**
3. Configure your Stable Diffusion servers:
   - **Name**: Descriptive name (e.g., "Laptop", "ArchLinux")
   - **URL**: Base URL (e.g., `http://192.168.1.100:7860`)
   - **Authentication**: Username/password if required

### API Key Management

For external applications (like Forge extensions):

1. Navigate to **API Keys** tab in the web UI
2. Click **Create New Key**
3. Provide name and description
4. Copy the generated key and secret
5. Use these credentials in external applications

**Important Notes**:
- The web UI has full administrative access and doesn't require API keys
- API keys are **only** for external applications
- Both `X-API-Key`/`X-API-Secret` and `Authorization: Bearer` headers are supported

## 📡 API Documentation

### Authentication

External applications must authenticate using API keys:

```bash
# Method 1: Using X-API-Key and X-API-Secret headers (recommended)
curl -H "X-API-Key: mk_your_api_key" \
     -H "X-API-Secret: your_api_secret" \
     http://localhost:8083/api/v1/generate

# Method 2: Using Authorization header (for compatibility)
curl -H "Authorization: Bearer $(echo -n 'api_key:api_secret' | base64)" \
     http://localhost:8083/api/v1/generate
```

### Job Submission

Submit image generation jobs with full parameter support:

```bash
curl -X POST http://localhost:8083/api/v1/generate \
  -H "Content-Type: application/json" \
  -H "X-API-Key: mk_your_api_key" \
  -H "X-API-Secret: your_api_secret" \
  -d '{
    "target_server_alias": "ArchLinux",
    "generation_params": {
      "positive_prompt": "a beautiful landscape, masterpiece, detailed",
      "negative_prompt": "ugly, blurry, low quality",
      "checkpoint_name": "realismEngineSDXL_v30VAE.safetensors",
      "model_hash": "abc123def456",
      "width": 1024,
      "height": 1024,
      "steps": 20,
      "cfg_scale": 7,
      "sampler_name": "Euler a",
      "seed": -1
    }
  }'
```

### Job Status and Results

Monitor job progress and retrieve results:

```bash
# Get job status
curl -H "X-API-Key: your_key" \
     -H "X-API-Secret: your_secret" \
     http://localhost:8083/api/v1/queue/jobs/JOB_ID/status

# List all jobs
curl -H "X-API-Key: your_key" \
     -H "X-API-Secret: your_secret" \
     http://localhost:8083/api/v1/queue/jobs
```

For complete API documentation, see [docs/API.md](docs/API.md).

## 🧩 Forge Extension Integration

StableQueue is designed to work seamlessly with A1111 WebUI Forge through dedicated extensions.

### Supported Extensions

- **sd-civitai-browser-plus-stablequeue**: Enhanced version of the popular Civitai browser extension with StableQueue integration
- **StableQueue-Forge-Extension**: Dedicated Forge extension for direct job submission

### Extension Configuration

1. Install the extension in Forge WebUI
2. Go to **Settings** → **StableQueue** (or relevant extension settings)
3. Configure:
   - **Server URL**: Your StableQueue server (e.g., `http://192.168.73.124:8083`)
   - **API Key**: Generated from StableQueue web UI
   - **API Secret**: Corresponding secret from StableQueue

### Parameter Capture

The extensions automatically capture:
- All generation parameters from Forge UI
- Model checkpoints and LoRA information
- Image metadata when working with existing images
- Complete generation info strings from PNG metadata

## 🏗️ Architecture

### Core Components

- **Node.js/Express Backend**: RESTful API server with job management
- **Dual SQLite Architecture**: 
  - `mobilesd_jobs.sqlite`: Job queue, API keys, and processing status
  - `mobilesd_models.sqlite`: Model metadata, availability tracking, and Civitai integration
- **Web Frontend**: Administrative interface built with vanilla HTML/CSS/JavaScript
- **Job Dispatcher**: Background service for processing and monitoring jobs
- **Progress Monitor**: Real-time WebSocket updates for job status
- **Image Handler**: Automatic saving and gallery management
- **Model Database System**: Comprehensive model management with hash-based identification and server availability tracking

### Key Design Principles

- **Simplicity First**: No complex setup wizards or unnecessary configuration
- **Reliability**: Jobs persist through restarts and network issues
- **Flexibility**: Support multiple authentication methods and parameter formats
- **Production Ready**: Docker deployment with proper error handling
- **Database Integrity**: Automated migration system with backup protection for schema updates

## 🔧 Environment Variables

StableQueue uses environment variables for configuration. Copy the example file and customize for your environment:

```bash
cp .env.example .env
# Edit .env with your specific configuration
```

### Key Configuration Variables

- **`PORT`**: API server port (default: 3000)
- **`CONFIG_DATA_PATH`**: Data directory for SQLite databases
- **`STABLE_DIFFUSION_SAVE_PATH`**: Directory for generated images
- **`LORA_PATH`**: LoRA models directory
- **`CHECKPOINT_PATH`**: Checkpoint models directory
- **`CIVITAI_API_KEY`**: Civitai API key for model metadata
- **`UNRAID_HOST`**: Target Unraid server for deployment
- **`UNRAID_USER`**: SSH user for Unraid deployment

For the complete list of available environment variables, see [`.env.example`](.env.example).

### Volume Mappings (Docker)

```yaml
volumes:
  - ./data:/usr/src/app/data                           # SQLite databases and configuration
  - /mnt/user/Stable_Diffusion_Data/outputs/StableQueue:/app/outputs
  - /mnt/user/Stable_Diffusion_Data/models/Lora:/app/models/Lora
  - /mnt/user/Stable_Diffusion_Data/models/Stable-diffusion:/app/models/Stable-diffusion
```

**Important**: The `/data` directory contains both SQLite databases (`mobilesd_jobs.sqlite` and `mobilesd_models.sqlite`) and must be properly mapped to ensure data persistence across container updates.

## 🚀 Deployment

### Production Deployment (Unraid)

The project includes an automated deployment script optimized for Unraid servers:

```bash
./deploy-stablequeue-to-unraid.sh
```

**Features**:
- Automatic image building and transfer
- Job queue clearing before deployment
- Volume mapping for shared model libraries
- Environment variable injection
- Container restart with preserved data

### Manual Docker Deployment

```bash
# Build and start
docker-compose up -d

# View logs
docker-compose logs -f stablequeue

# Stop and clean up
docker-compose down
```

## 🧪 Testing

The project includes comprehensive API testing:

```bash
# Run all API tests
npm run test:api

# Run tests with verbose output
npm run test:api:verbose

# Run manual testing scripts
npm run test:api:manual
```

## 📁 Project Structure

```
StableQueue/
├── app.js                     # Main application entry point
├── package.json              # Node.js dependencies and scripts
├── .env.example              # Environment configuration template
├── docker-compose.yml        # Docker deployment configuration
├── deploy-stablequeue-to-unraid.sh # Automated deployment script
├── routes/                    # API route handlers
├── services/                  # Core business logic
├── middleware/                # Authentication and CORS
├── public/                    # Web UI static files
├── scripts/                   # Testing and utility scripts
├── data/                      # SQLite database and configuration
└── docs/                      # Comprehensive documentation
```

## 📚 Documentation

- **[API.md](docs/API.md)**: Complete API reference
- **[DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md)**: Comprehensive database schema documentation
- **[DEPLOYMENT_STATUS.md](docs/DEPLOYMENT_STATUS.md)**: Current deployment information
- **[FORGE_EXTENSION_PLAN.md](docs/FORGE_EXTENSION_PLAN.md)**: Extension development guide
- **[API_KEY_UI_SUMMARY.md](docs/API_KEY_UI_SUMMARY.md)**: Authentication implementation details

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the ISC License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

**For Issues and Questions**:
- Check the [documentation](docs/) directory
- Review [existing issues](https://github.com/kelsjon3/StableQueue/issues)
- Create a new issue with detailed information

**Current Production Server**: http://192.168.73.124:8083

## 🔄 Recent Updates

- **Dual-Database Architecture**: Separated job queue and model management into optimized databases
- **Comprehensive Model System**: Hash-based model identification with Civitai integration and server availability tracking
- **Automated Migration System**: Safe database schema updates with automatic backups
- **Simplified Setup**: Removed complex "first-time setup" logic for reliability
- **Dual Authentication**: Support for both header-based and bearer token authentication
- **Enhanced Extensions**: Improved parameter capture from Forge UI and image metadata
- **Automatic Deployment**: Streamlined Unraid deployment with job queue management
- **Production Stability**: Comprehensive testing and error handling improvements

---

**Note**: This project focuses on simplicity and reliability. The core philosophy is "works immediately, no complex setup required" - if you encounter setup complexity, that's a bug to be fixed, not a feature to be documented. 