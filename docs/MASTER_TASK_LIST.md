# StableQueue Master Task List

This document serves as the definitive source for determining what to work on next in the StableQueue project. Tasks are organized by priority and component.

## High Priority Tasks

### Database Preparation for Extension Support
- [x] Add `app_type` field to jobs table with default 'forge' for backward compatibility
- [x] Add `source_info` field to track where jobs originate from (UI, extension, API)
- [x] Add `api_key_id` field to track which API key was used for authentication
- [x] Create `api_keys` table for storing and managing API authentication
- [x] Update database helper functions to support new fields
- [x] Add database migration script to safely update existing databases

### API Authentication System
- [x] Implement API key generation mechanism with secure random strings
- [x] Create API key validation and middleware for authentication
- [x] Add endpoints for API key management (create, list, delete, update)
- [x] Implement logging for API key usage and access attempts
- [x] Add rate limiting based on API key
- [x] Create UI for managing API keys

### API Standardization (for Extension Support)
- [x] Implement standardized job submission endpoint (`/api/v2/generate`)
- [x] Update job status endpoint to include additional fields for extensions
- [x] Enhance queue management endpoints with filtering by app_type
- [x] Create detailed API documentation specifically for extension developers
- [x] Implement proper error reporting from API to extension
- [x] Add automated tests for API endpoints

### Testing the New APIs
- [x] Test API key creation and management
- [x] Test API authentication with various scenarios (valid/invalid keys)
- [x] Test job submission via new v2 endpoint
- [x] Test handling of app_type and source_info fields
- [x] Create Postman collection for API testing

### Forge Extension Development
- [ ] Create basic extension structure (Python backend, JS frontend)
- [ ] Add "Send to StableQueue" option to right-click context menu in Forge UI
- [ ] Add "Send bulk job to StableQueue" option to right-click context menu in Forge UI
- [ ] Create a "StableQueue" tab in Forge settings for configuration options
- [ ] Implement bulk job quantity setting in StableQueue tab
- [ ] Implement parameter capture from Forge UI
- [ ] Add seed variation for bulk jobs
- [ ] Implement bulk job tracking with shared bulk_job_id
- [ ] Establish secure communication with StableQueue API
- [ ] Add configuration panel for server URL and API credentials
- [ ] Implement job status monitoring within extension
- [ ] Add progress indicator for bulk jobs
- [ ] Create cancellation mechanism for remaining jobs in a bulk submission

### Error Handling & Robustness
- [ ] Add reconnection logic for server disconnections
- [ ] Enhance logging for cross-component debugging, especially for extension-to-API communication
- [ ] Implement request validation and sanitization for incoming extension requests
- [ ] Add detailed error responses with actionable information

## Medium Priority Tasks

### Multi-Application Support Core
- [ ] Create dispatcher registry for managing multiple application types
- [ ] Update UI to display application type in queue view
- [ ] Implement application-specific progress tracking

### Queue Management Enhancements
- [ ] Add job reordering and prioritization features
- [ ] Implement more detailed job status reporting
- [ ] Create job dependency system for complex workflows

## Lower Priority Tasks

### Gallery Implementation
- [ ] Complete API endpoints for listing and serving images
- [ ] Implement image metadata association with original generation jobs
- [ ] Add support for image sorting and filtering
- [ ] Create Gallery UI tab with thumbnails and preview functionality

### Civitai Integration
- [ ] Implement automatic model detection during job processing
- [ ] Add on-demand model downloading when missing models are detected
- [ ] Integrate with Download Queue Manager for prioritized model downloads

### Model Management
- [ ] Create user-friendly UI for browsing and managing Civitai models
- [ ] Implement model update checking
- [ ] Add one-click model updating

### ComfyUI Support
- [ ] Research ComfyUI API and workflow structure
- [ ] Develop ComfyUI extension
- [ ] Create ComfyUI-specific dispatcher
- [ ] Implement progress monitoring for ComfyUI jobs

### Resource Management
- [ ] Implement GPU memory monitoring
- [ ] Develop intelligent job scheduling based on resource requirements
- [ ] Add priority system that considers both user preference and resource availability
- [ ] Create resource reservation system to prevent conflicts

### Documentation & Testing
- [ ] Create comprehensive testing procedures for different scenarios
- [ ] Document common issues and solutions
- [ ] Create user guides for different features
- [ ] Implement automatic recovery mechanisms for database corruption

## Completed Tasks

- [x] Core StableQueue Application & Docker Setup
- [x] Dynamic Server Configuration Management
- [x] Job Queue System with SQLite persistence
- [x] Job Dispatcher Service
- [x] Forge Job Monitoring with SSE and polling
- [x] Model Database System with path normalization
- [x] Basic Civitai metadata compatibility
- [x] Queue Management UI tab
- [x] Job deletion functionality
- [x] Database schema updates for extension support
- [x] API key management system
- [x] V2 API endpoint for job submission
- [x] Rate limiting for API endpoints based on API key tiers

## Task Dependencies

1. ✅ Database Preparation must be completed before API Standardization
2. ✅ API Authentication System must be completed before Forge Extension can be fully implemented
3. ✅ Forge Extension development requires standardized API endpoints
4. Multi-Application Support is a prerequisite for ComfyUI Support
5. Resource Management should follow after basic Multi-Application Support
6. Gallery Implementation and Civitai Integration can be developed independently

## Notes for Implementation

- When implementing new features, always update this task list
- Mark tasks as completed with [x] instead of [ ]
- Add new tasks as they are identified
- If task priorities change, move them to the appropriate section 