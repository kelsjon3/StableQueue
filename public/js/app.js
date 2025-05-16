document.addEventListener('DOMContentLoaded', () => {
    const serverAliasSelect = document.getElementById('server-alias-select');
    const serverListUL = document.getElementById('server-list'); // For Server Setup page
    const checkpointSelect = document.getElementById('checkpoint-select'); // For Generator page

    // LoRA Selection Elements
    const loraRowsContainer = document.getElementById('lora-rows-container');
    const addLoraBtn = document.getElementById('add-lora-btn');
    const loraRowTemplate = document.getElementById('lora-row-template');

    // Server Setup Form Elements
    const serverForm = document.getElementById('server-form');
    const serverAliasInput = document.getElementById('server-alias');
    const serverApiUrlInput = document.getElementById('server-api-url');
    const serverAuthUserInput = document.getElementById('server-auth-user');
    const serverAuthPassInput = document.getElementById('server-auth-pass');
    const serverModelRootPathInput = document.getElementById('server-model-root-path');
    const browseModelPathBtn = document.getElementById('browse-model-path-btn');
    const editAliasInput = document.getElementById('edit-alias'); // Hidden field for editing
    const saveServerBtn = document.getElementById('save-server-btn');
    const cancelEditBtn = document.getElementById('cancel-edit-btn');

    // Generator Page Elements
    const generateBtn = document.getElementById('generate-btn');
    const positivePromptInput = document.getElementById('positive-prompt');
    const negativePromptInput = document.getElementById('negative-prompt');
    const stepsInput = document.getElementById('steps');
    const cfgScaleInput = document.getElementById('cfg-scale');
    const widthInput = document.getElementById('width');
    const heightInput = document.getElementById('height');
    const seedInput = document.getElementById('seed');

    // New input fields (assuming IDs exist or will be added in index.html)
    const stylePresetInput = document.getElementById('style-preset');
    const samplingCategoryInput = document.getElementById('sampling-category');
    const enableHiresFixInput = document.getElementById('enable-hires-fix');
    const upscalerModelInput = document.getElementById('upscaler-model');
    const refinerModelInput = document.getElementById('refiner-model');
    const numImagesInput = document.getElementById('num-images');
    const subseedInput = document.getElementById('subseed');
    const samplerNameInput = document.getElementById('sampler-name');
    const restoreFacesInput = document.getElementById('restore-faces');
    const schedulerOrQualityPresetInput = document.getElementById('scheduler-or-quality-preset');

    // Progress and Output Elements
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');
    const progressImagePreview = document.getElementById('progress-image-preview');
    const outputImageContainer = document.getElementById('output-image-container');
    const outputInfo = document.getElementById('output-info');

    // Gallery Elements
    const galleryImagesContainer = document.getElementById('gallery-images');
    const galleryLoading = document.getElementById('gallery-loading');
    const galleryEmpty = document.getElementById('gallery-empty');
    const refreshGalleryBtn = document.getElementById('refresh-gallery-btn');
    const gallerySearchInput = document.getElementById('gallery-search');
    const imageViewerModal = document.getElementById('image-viewer-modal');
    const modalImage = document.getElementById('modal-image');
    const modalImageInfo = document.getElementById('modal-image-info');
    const deleteImageBtn = document.getElementById('delete-image-btn');
    const closeModalBtn = document.querySelector('.close-modal');

    // Queue Elements
    const queueJobsTable = document.getElementById('queue-jobs');
    const queueLoading = document.getElementById('queue-loading');
    const queueEmpty = document.getElementById('queue-empty');
    const refreshQueueBtn = document.getElementById('refresh-queue-btn');
    const queueStatusFilter = document.getElementById('queue-status-filter');
    const jobDetailsModal = document.getElementById('job-details-modal');
    const jobDetailsContent = document.getElementById('job-details-content');
    const cancelJobBtn = document.getElementById('cancel-job-btn');
    const deleteJobBtn = document.getElementById('delete-job-btn');
    const viewJobResultsBtn = document.getElementById('view-job-results-btn');
    const jobDetailsCloseBtn = jobDetailsModal ? jobDetailsModal.querySelector('.close-modal') : null;

    // Models Tab Elements
    const modelsGrid = document.getElementById('models-grid');
    const modelsLoading = document.getElementById('models-loading');
    const modelsEmpty = document.getElementById('models-empty');
    const refreshModelsBtn = document.getElementById('refresh-models-btn');
    const modelTypeFilter = document.getElementById('model-type-filter');
    const baseModelFilter = document.getElementById('base-model-filter');
    const modelSearchInput = document.getElementById('model-search');
    const modelDetailsModal = document.getElementById('model-details-modal');
    const modelPreviewImage = document.getElementById('model-preview-image');
    const modelName = document.getElementById('model-name');
    const modelTypeBadge = document.getElementById('model-type-badge');
    const modelBaseBadge = document.getElementById('model-base-badge');
    const modelDescription = document.getElementById('model-description');
    const modelDetails = document.getElementById('model-details');
    const modelCivitaiLink = document.getElementById('model-civitai-link');
    const modelDetailsCloseBtn = modelDetailsModal ? modelDetailsModal.querySelector('.close-modal') : null;

    let allServersCache = []; // Cache for server data to assist with editing
    let allLorasCache = []; // Cache for LoRA data
    let currentEventSource = null; // To keep track of the active SSE connection
    let allModels = []; // Cache for all models
    let baseModelsList = []; // List of unique base models for filter
    let currentJobId = null; // Track the current job ID for the progress display
    let currentJob = null; // Track the current job object
    let jobClient = null; // Will hold the WebSocket client for job updates

    // Initialize the WebSocket client for real-time job updates
    function initializeJobClient() {
        console.log('Initializing job status WebSocket client...');
        
        // Create a new instance of MobileSdJobClient
        jobClient = new MobileSdJobClient({
            autoReconnect: true
        });

        // Subscribe to job updates
        jobClient.onConnect(() => {
            console.log('Connected to job status WebSocket server successfully');
            
            // Debug: Log the current state of the socket
            if (jobClient.socket) {
                console.log('Socket state:', {
                    id: jobClient.socket.id,
                    connected: jobClient.socket.connected,
                    disconnected: jobClient.socket.disconnected
                });
            }
        });

        jobClient.onDisconnect(() => {
            console.log('Disconnected from job status WebSocket server');
        });

        // Handle initial jobs load
        jobClient.onInitialJobs(jobs => {
            console.log(`Received ${jobs.length} jobs from WebSocket server`);
            console.log('Job statuses:', jobs.map(job => ({ id: job.mobilesd_job_id, status: job.status })));
            
            // Update queue UI if we're on that page
            if (document.getElementById('queue-view').style.display !== 'none') {
                displayQueueJobs(jobs);
            }
            
            // If we have a current job in progress, check if it's updated
            if (currentJobId) {
                const updatedJob = jobs.find(job => job.mobilesd_job_id === currentJobId);
                if (updatedJob) {
                    currentJob = updatedJob;
                    updateProgressUI(updatedJob);
                }
            }
        });

        // Handle job updates
        jobClient.onJobUpdate(job => {
            console.log(`Job ${job.mobilesd_job_id} updated: ${job.status}`);
            
            // Debug: Log more details about the updated job
            console.log('Updated job details:', {
                id: job.mobilesd_job_id,
                status: job.status,
                hasResultDetails: !!job.result_details,
                progress: job.result_details?.progress_percentage,
                hasPreview: !!job.result_details?.preview_image,
                hasCompletedImages: !!(job.result_details?.saved_filenames && job.result_details?.saved_filenames.length > 0)
            });
            
            // Update queue row if this job is in the queue
            updateQueueJobRow(job);
            
            // If this is our current job, update the progress UI
            if (currentJobId && job.mobilesd_job_id === currentJobId) {
                currentJob = job;
                updateProgressUI(job);
                
                // If the job is complete, display the results
                if (job.status === 'completed' && job.result_details) {
                    // Log that we're about to display completed job images
                    console.log('Job completed, displaying results:', job.mobilesd_job_id);
                    console.log('Result details available:', !!job.result_details);
                    console.log('Saved filenames:', job.result_details?.saved_filenames);
                    console.log('Legacy images field:', job.result_details?.images);
                    displayCompletedJobImages(job);
                }
            }
        });

        // Handle progress updates with improved image preview
        jobClient.onJobProgress(progressData => {
            const { jobId, progress_percentage, preview_image } = progressData;
            console.log(`Job progress update: Job ${jobId} at ${progress_percentage}% complete, preview: ${preview_image || 'none'}`);
            
            try {
                // First, see if we have this job in the job table
                const table = document.getElementById('job-queue-table');
                if (table) {
                    let row = [...table.querySelectorAll('tr')].find(row => {
                        const idCell = row.querySelector('.job-id');
                        return idCell && idCell.textContent.trim() === jobId;
                    });
                    
                    if (row) {
                        // We have this job in the UI - let's update it with progress info
                        
                        // Update the status cell if needed
                        const statusCell = row.querySelector('.job-status');
                        if (statusCell && !statusCell.classList.contains('job-status-processing')) {
                            statusCell.textContent = 'processing';
                            statusCell.className = 'job-status job-status-processing';
                        }
                        
                        // Add or update progress bar
                        let progressContainer = row.querySelector('.job-progress-container');
                        if (!progressContainer) {
                            // No progress bar yet - add one to the row
                            const progressCell = row.querySelector('td:nth-child(2)'); // Status column
                            if (progressCell) {
                                const progressHtml = `
                                    <div class="job-progress-container">
                                        <div class="job-progress-bar">
                                            <div class="job-progress-bar-fill" style="width: ${progress_percentage}%"></div>
                                        </div>
                                        <div class="job-progress-text">${progress_percentage.toFixed(1)}%</div>
                                    </div>
                                `;
                                progressCell.innerHTML = `<span class="job-status job-status-processing">processing</span>${progressHtml}`;
                            }
                        } else {
                            // Update existing progress bar
                            const fillBar = progressContainer.querySelector('.job-progress-bar-fill');
                            const progressText = progressContainer.querySelector('.job-progress-text');
                            if (fillBar) fillBar.style.width = `${progress_percentage}%`;
                            if (progressText) progressText.textContent = `${progress_percentage.toFixed(1)}%`;
                        }
                        
                        // Display preview image if available
                        if (preview_image && preview_image.length > 0) {
                            let previewImg = row.querySelector('.job-preview-image');
                            if (!previewImg) {
                                // If there was no preview before but now there is, add it
                                const progressCell = row.querySelector('td:nth-child(2)'); // Status column
                                if (progressCell) {
                                    const previewHtml = `
                                        <div class="job-preview-container">
                                            <img class="job-preview-image" src="/outputs/${preview_image}?t=${Date.now()}" alt="Preview">
                                        </div>
                                    `;
                                    progressCell.innerHTML += previewHtml;
                                }
                            } else {
                                // Update existing preview image with cache-busting
                                previewImg.src = `/outputs/${preview_image}?t=${Date.now()}`;
                            }
                        }
                    }
                }
                
                // Now handle current job progress UI update
                if (jobId === currentJobId) {
                    // Update progress bar
                    if (progressBar) {
                        progressBar.value = progress_percentage;
                        progressText.textContent = `Processing: ${progress_percentage.toFixed(1)}%`;
                    }
                    
                    // Update preview image if available
                    if (preview_image && preview_image.length > 0 && progressImagePreview) {
                        console.log(`Updating progress image preview with: ${preview_image}`);
                        progressImagePreview.src = `/outputs/${preview_image}?t=${Date.now()}`;
                        progressImagePreview.style.display = 'block';
                    }
                }
            } catch (err) {
                console.error('Error updating job progress in UI:', err);
            }
        });
        
        console.log('Job status WebSocket client initialization complete');
    }

    // Function to update the progress UI based on job status
    function updateProgressUI(job) {
        if (!job) return;
        
        const status = job.status;
        
        // Update progress elements based on status
        if (progressBar && progressText) {
            switch (status) {
                case 'pending':
                    progressBar.value = 0;
                    progressText.textContent = 'Pending: Waiting to start...';
                    progressImagePreview.style.display = 'none';
                    break;
                    
                case 'processing':
                    // Get progress from result_details if available
                    const progress = job.result_details && job.result_details.progress_percentage 
                        ? job.result_details.progress_percentage 
                        : 0;
                    
                    progressBar.value = progress;
                    progressText.textContent = `Processing: ${progress}%`;
                    
                    // Check for preview image
                    if (job.result_details && job.result_details.preview_image) {
                        progressImagePreview.src = `/outputs/${job.result_details.preview_image}`;
                        progressImagePreview.style.display = 'block';
                    }
                    break;
                    
                case 'completed':
                    progressBar.value = 100;
                    progressText.textContent = 'Completed';
                    break;
                    
                case 'failed':
                    progressBar.value = 0;
                    progressText.textContent = `Failed: ${job.result_details && job.result_details.error 
                        ? job.result_details.error 
                        : 'Unknown error'}`;
                    break;
                    
                case 'cancelled':
                    progressBar.value = 0;
                    progressText.textContent = 'Cancelled';
                    break;
                    
                default:
                    progressBar.value = 0;
                    progressText.textContent = `Unknown status: ${status}`;
            }
        }
    }

    // Function to update a job row in the queue table
    function updateQueueJobRow(job) {
        // Only update if we're on the queue page
        if (document.getElementById('queue-view').style.display === 'none') return;
        
        // Check if the row exists already
        const existingRow = document.getElementById(`job-row-${job.mobilesd_job_id}`);
        
        if (existingRow) {
            // Update the status badge
            const statusCell = existingRow.querySelector('td:nth-child(2)');
            if (statusCell) {
                // Clear the status cell contents
                const statusBadge = `<span class="job-status job-status-${job.status.toLowerCase()}">${job.status}</span>`;
                
                // Check if we have a progress percentage for 'processing' jobs
                let progressHtml = '';
                let previewHtml = '';
                
                if (job.status === 'processing') {
                    // IMPORTANT: Always include progress bar for processing jobs, even if percentage is 0
                    // Use progress_percentage if available, otherwise default to 0
                    const progressPercentage = job.result_details?.progress_percentage || 0;
                    progressHtml = `
                        <div class="job-progress-container">
                            <div class="job-progress-bar">
                                <div class="job-progress-bar-fill" style="width: ${progressPercentage}%"></div>
                            </div>
                            <div class="job-progress-text">${progressPercentage.toFixed(1)}%</div>
                        </div>
                    `;
                    
                    // Add preview image if available
                    if (job.result_details && job.result_details.preview_image) {
                        previewHtml = `
                            <div style="margin-top: 0.5rem;">
                            <img src="/outputs/${job.result_details.preview_image}?t=${Date.now()}" 
                                     alt="Preview" 
                                     class="job-preview-image"
                                     loading="lazy">
                            </div>
                        `;
                    }
                }
                
                // Update the status cell with all components
                statusCell.innerHTML = `
                    ${statusBadge}
                    ${progressHtml}
                    ${previewHtml}
                `;
            }
            
            // If we're filtering by status, hide/show based on filter
            const currentFilter = queueStatusFilter.value;
            if (currentFilter && currentFilter !== '') {
                existingRow.style.display = job.status.toLowerCase() === currentFilter.toLowerCase() ? '' : 'none';
            }
        } else {
            // Row doesn't exist, refresh the queue
            loadQueueJobs();
        }
    }

    async function fetchAndPopulateServers() {
        if (!serverAliasSelect) {
            console.error('Server alias select dropdown not found.');
            return;
        }

        serverAliasSelect.innerHTML = '<option value="">Loading servers...</option>'; // Clear existing options and show loading

        try {
            const response = await fetch('/api/v1/servers');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const servers = await response.json();
            allServersCache = servers; // Update cache
            serverAliasSelect.innerHTML = ''; // Clear loading message

            if (servers.length === 0) {
                serverAliasSelect.innerHTML = '<option value="">No servers configured</option>';
            } else {
                servers.forEach(server => {
                    const option = document.createElement('option');
                    option.value = server.alias; // Assuming alias is unique and used as an identifier
                    option.textContent = server.alias;
                    serverAliasSelect.appendChild(option);
                });
            }
        } catch (error) {
            console.error('Error fetching servers for dropdown:', error);
            allServersCache = []; // Clear cache on error
            serverAliasSelect.innerHTML = '<option value="">Error loading servers</option>';
            // Optionally, display a more user-friendly error message on the page
        }
    }

    // Function to fetch and populate checkpoints for the Generator page
    async function fetchAndPopulateCheckpoints() {
        if (!checkpointSelect) {
            console.error('Checkpoint select dropdown not found.');
            return;
        }

        checkpointSelect.innerHTML = '<option value="">Loading checkpoints...</option>';

        try {
            const response = await fetch('/api/v1/checkpoints');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const checkpointsData = await response.json(); // Expects an array of objects like [{filename: 'name.safetensors', ...}]

            checkpointSelect.innerHTML = ''; // Clear loading message

            if (checkpointsData.length === 0) {
                checkpointSelect.innerHTML = '<option value="">No checkpoints found</option>';
            } else {
                checkpointsData.forEach(checkpointObj => {
                    const option = document.createElement('option');
                    if (checkpointObj && typeof checkpointObj.filename === 'string') {
                        let fullPath = checkpointObj.filename;
                        if (checkpointObj.relativePath && checkpointObj.relativePath !== '') {
                            fullPath = `${checkpointObj.relativePath}/${checkpointObj.filename}`;
                        }
                        option.value = fullPath;  // Set value to full path
                        option.textContent = fullPath;  // Display full path
                        checkpointSelect.appendChild(option);
                    } else {
                        console.warn('Received invalid checkpoint object:', checkpointObj);
                    }
                });
            }
        } catch (error) {
            console.error('Error fetching checkpoints:', error);
            checkpointSelect.innerHTML = '<option value="">Error loading checkpoints</option>';
        }
    }

    // Function to fetch LoRAs and cache them for dynamic row generation
    async function fetchAndCacheLoras() {
        try {
            const response = await fetch('/api/v1/loras');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            allLorasCache = await response.json(); // Expects an array of objects like [{filename: 'name.safetensors', relativePath: 'subfolder' ...}]
            // console.log('LoRAs cached:', allLorasCache); // For debugging
            if (allLorasCache.length === 0) {
                // Optionally, disable the "Add LoRA" button or show a message if no LoRAs are available
                console.info('No LoRAs found in library.');
            }
        } catch (error) {
            console.error('Error fetching LoRAs for cache:', error);
            allLorasCache = []; // Clear cache on error
            // Optionally, display an error message or disable LoRA functionality
        }
    }

    // Function to fetch and display servers on the Server Setup page
    async function fetchAndDisplayServers() {
        if (!serverListUL) {
            console.error('Server list UL element not found.');
            return;
        }

        serverListUL.innerHTML = '<li>Loading server configurations...</li>'; // Show loading message

        try {
            const response = await fetch('/api/v1/servers');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const servers = await response.json();

            serverListUL.innerHTML = ''; // Clear loading message

            if (servers.length === 0) {
                serverListUL.innerHTML = '<li>No servers configured yet. Add one below.</li>';
            } else {
                servers.forEach(server => {
                    const listItem = document.createElement('li');
                    listItem.innerHTML = `
                        <strong>Alias:</strong> ${server.alias}<br>
                        <strong>URL:</strong> ${server.apiUrl}<br>
                        <strong>Auth:</strong> ${server.authUser ? 'Username/Password' : 'None'}<br>
                        <strong>Model Root:</strong> ${server.modelRootPath || '<not set>'}
                        <div class="server-actions">
                            <button class="edit-server-btn" data-alias="${server.alias}">Edit</button>
                            <button class="delete-server-btn" data-alias="${server.alias}">Delete</button>
                        </div>
                    `;
                    
                    const editBtn = listItem.querySelector('.edit-server-btn');
                    if (editBtn) {
                        editBtn.addEventListener('click', () => populateFormForEdit(server.alias));
                    }

                    const deleteBtn = listItem.querySelector('.delete-server-btn');
                    if (deleteBtn) {
                        deleteBtn.addEventListener('click', () => handleDeleteServer(server.alias));
                    }
                    // TODO: Add event listeners for these edit buttons
                    serverListUL.appendChild(listItem);
                });
            }
        } catch (error) {
            console.error('Error fetching servers for setup page:', error);
            serverListUL.innerHTML = '<li>Error loading server configurations.</li>';
        }
    }

    function populateFormForEdit(alias) {
        const serverToEdit = allServersCache.find(s => s.alias === alias);
        if (!serverToEdit) {
            alert('Could not find server details to edit.');
            return;
        }

        serverAliasInput.value = serverToEdit.alias;
        serverApiUrlInput.value = serverToEdit.apiUrl;
        serverAuthUserInput.value = serverToEdit.authUser || '';
        serverAuthPassInput.value = serverToEdit.authPass || '';
        serverModelRootPathInput.value = serverToEdit.modelRootPath || '';
        editAliasInput.value = serverToEdit.alias; // Set the original alias for update reference

        saveServerBtn.textContent = 'Update Server';
        cancelEditBtn.style.display = 'inline-block';
        serverAliasInput.focus(); // Focus on the first field
    }

    if (cancelEditBtn) {
        cancelEditBtn.addEventListener('click', () => {
            serverForm.reset();
            editAliasInput.value = '';
            saveServerBtn.textContent = 'Save Server';
            cancelEditBtn.style.display = 'none';
        });
    }

    // Function to handle deleting a server
    async function handleDeleteServer(alias) {
        if (!alias) {
            console.error('Alias not provided for deletion');
            return;
        }

        if (!confirm(`Are you sure you want to delete the server "${alias}"?`)) {
            return; // User cancelled
        }

        try {
            const response = await fetch(`/api/v1/servers/${alias}`, {
                method: 'DELETE',
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: 'Failed to delete server. Unknown error.' }));
                throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
            }

            alert(`Server "${alias}" deleted successfully!`);
            await fetchAndDisplayServers(); // Refresh list on setup page
            await fetchAndPopulateServers(); // Refresh dropdown on generator page

        } catch (error) {
            console.error('Error deleting server:', error);
            alert(`Error deleting server: ${error.message}`);
        }
    }

    // Handle Server Form Submission (Add/Edit)
    if (serverForm) {
        serverForm.addEventListener('submit', async (event) => {
            event.preventDefault(); // Prevent default page reload

            const alias = serverAliasInput.value.trim();
            const apiUrl = serverApiUrlInput.value.trim();
            const authUser = serverAuthUserInput.value.trim();
            const authPass = serverAuthPassInput.value.trim();
            const modelRootPath = serverModelRootPathInput.value.trim();
            const originalAliasForUpdate = editAliasInput.value; // Original alias if in edit mode

            if (!alias || !apiUrl) {
                alert('Server Alias and API URL are required.');
                return;
            }

            const serverData = {
                alias,
                apiUrl,
                ...(authUser && { authUser }),
                ...(authPass && { authPass }),
                modelRootPath,
            };

            let method = 'POST';
            let url = '/api/v1/servers';

            if (originalAliasForUpdate) {
                method = 'PUT';
                url = `/api/v1/servers/${originalAliasForUpdate}`;
            }

            try {
                const response = await fetch(url, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(serverData),
                });
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({ message: `Failed to ${originalAliasForUpdate ? 'update' : 'save'} server. Unknown error.` }));
                    throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
                }
                alert(`Server '${alias}' ${originalAliasForUpdate ? 'updated' : 'saved'} successfully!`);
                serverForm.reset();
                editAliasInput.value = '';
                saveServerBtn.textContent = 'Save Server';
                cancelEditBtn.style.display = 'none';

                await fetchAndDisplayServers();
                await fetchAndPopulateServers();
            } catch (error) {
                console.error(`Error ${originalAliasForUpdate ? 'updating' : 'saving'} server:`, error);
                alert(`Error ${originalAliasForUpdate ? 'updating' : 'saving'} server: ${error.message}`);
            }
        });
    }

    // Handle model root path browse button
    if (browseModelPathBtn) {
        browseModelPathBtn.addEventListener('click', () => {
            // We can't actually open a native file browser without a server-side component
            // Instead, show a dialog with instructions
            alert('Enter the full path to your models folder, for example:\n\n' +
                'On Windows: C:\\models or D:\\stable-diffusion\\models\n' +
                'On Linux: /home/user/models or /mnt/user/models\n\n' +
                'This should be the folder that contains subdirectories like "Stable-diffusion", "Lora", etc.');
        });
    }

    // Initial population of servers
    fetchAndPopulateServers();
    // Initial population of checkpoints for the generator page
    fetchAndPopulateCheckpoints();
    fetchAndCacheLoras(); // Fetch and cache LoRAs on load

    // Navigation
    const navGeneratorBtn = document.getElementById('nav-generator');
    const navServerSetupBtn = document.getElementById('nav-server-setup');
    const navGalleryBtn = document.getElementById('nav-gallery');
    const navQueueBtn = document.getElementById('nav-queue');
    const navModelsBtn = document.getElementById('nav-models');
    const generatorView = document.getElementById('generator-view');
    const serverSetupView = document.getElementById('server-setup-view');
    const galleryView = document.getElementById('gallery-view');
    const queueView = document.getElementById('queue-view');
    const modelsView = document.getElementById('models-view');

    function showView(viewToShow, buttonToActivate) {
        // Hide all views
        const views = ['generator-view', 'server-setup-view', 'gallery-view', 'queue-view', 'models-view'];
        views.forEach(view => {
            const element = document.getElementById(view);
            if (element) {
                element.style.display = 'none';
            }
        });
        
        // Show the requested view
        const viewElement = document.getElementById(viewToShow);
        if (viewElement) {
            viewElement.style.display = 'block';
        }
        
        // Update navigation button states
        const navButtons = document.querySelectorAll('.nav-button');
        navButtons.forEach(button => {
            button.classList.remove('active');
        });
        
        const activeButton = document.getElementById(buttonToActivate);
        if (activeButton) {
            activeButton.classList.add('active');
        }
    }

    if (navGeneratorBtn && navServerSetupBtn && navGalleryBtn && navQueueBtn && navModelsBtn && generatorView && serverSetupView && galleryView && queueView && modelsView) {
        navGeneratorBtn.addEventListener('click', () => {
            showView('generator-view', 'nav-generator');
        });

        navServerSetupBtn.addEventListener('click', () => {
            showView('server-setup-view', 'nav-server-setup');
            fetchAndDisplayServers(); // Fetch and display servers when switching to this view
        });

        navGalleryBtn.addEventListener('click', () => {
            showView('gallery-view', 'nav-gallery');
            loadGalleryImages(); // Load images when navigating to gallery
        });

        navQueueBtn.addEventListener('click', () => {
            showView('queue-view', 'nav-queue');
            loadQueueJobs(); // Load jobs when navigating to queue
        });

        navModelsBtn.addEventListener('click', () => {
            showView('models-view', 'nav-models');
            loadModels();
        });

        // Initially show the generator view
        showView('generator-view', 'nav-generator');
    } else {
        console.error('One or more navigation elements or views not found.');
    }

    function createLoraRow() {
        if (!loraRowTemplate) {
            console.error('LoRA row template not found.');
            return null;
        }

        const newRow = loraRowTemplate.cloneNode(true);
        newRow.removeAttribute('id'); // Remove ID from clone to avoid duplicates
        newRow.style.display = ''; // Make it visible (template is display:none). It has grid-container class.

        const loraSelect = newRow.querySelector('.lora-select');
        const removeLoraBtn = newRow.querySelector('.remove-lora-btn');

        if (!loraSelect || !removeLoraBtn) {
            console.error('Elements missing in LoRA row template clone.');
            return null;
        }

        // Populate LoRA select dropdown
        loraSelect.innerHTML = '<option value="">Select LoRA...</option>'; // Default option
        if (allLorasCache.length > 0) {
            allLorasCache.forEach(loraObj => {
                const option = document.createElement('option');
                if (loraObj && typeof loraObj.filename === 'string') {
                    option.value = loraObj.filename;
                    let displayText = loraObj.filename;
                    if (loraObj.relativePath && loraObj.relativePath !== '') {
                        displayText = `${loraObj.relativePath}/${loraObj.filename}`;
                    }
                    option.textContent = displayText;
                    loraSelect.appendChild(option);
                } else {
                    console.warn('Received invalid LoRA object in cache:', loraObj);
                }
            });
        } else {
            loraSelect.innerHTML = '<option value="">No LoRAs available</option>';
            loraSelect.disabled = true;
        }

        // Add event listener to the remove button for this specific row
        removeLoraBtn.addEventListener('click', () => {
            newRow.remove(); // Remove this LoRA row from the DOM
        });

        return newRow;
    }

    if (addLoraBtn && loraRowsContainer) {
        addLoraBtn.addEventListener('click', () => {
            const newLoraRow = createLoraRow();
            if (newLoraRow) {
                loraRowsContainer.appendChild(newLoraRow);
            }
        });
    } else {
        console.error('Add LoRA button or LoRA rows container not found.');
    }

    // --- GENERATOR PAGE LOGIC ---

    // Modified handleGenerateImageClick function to use WebSocket updates
    async function handleGenerateImageClick(event) {
        event.preventDefault();
        
        // Basic validation
        if (!serverAliasSelect || !serverAliasSelect.value) {
            alert('Please select a server first.');
            return;
        }
        
        if (!positivePromptInput || !positivePromptInput.value.trim()) {
            alert('Please enter a positive prompt.');
            return;
        }
        
        if (!checkpointSelect || !checkpointSelect.value) {
            alert('Please select a checkpoint model.');
            return;
        }
        
        // Disable generate button during processing
        generateBtn.disabled = true;
        
        // Reset output and progress areas
        outputImageContainer.innerHTML = '';
        outputInfo.innerHTML = '';
        progressText.innerText = 'Preparing job submission...';
        progressBar.value = 0;
        progressImagePreview.style.display = 'none';
        
        // Collect parameters from the form
        const targetServerAlias = serverAliasSelect.value;
        
        // Get LoRA values
        const loraRows = loraRowsContainer ? loraRowsContainer.querySelectorAll('.lora-row:not(#lora-row-template)') : [];
        const loraParams = [];
        
        loraRows.forEach(row => {
            const loraSelect = row.querySelector('.lora-select');
            const loraWeight = row.querySelector('.lora-weight');
            
            if (loraSelect && loraWeight && loraSelect.value) {
                loraParams.push({
                    model: loraSelect.value,
                    weight: parseFloat(loraWeight.value) || 0.8
                });
            }
        });
        
        // Build generation parameters object
        const generationParams = {
            prompt: positivePromptInput.value.trim(),
            negative_prompt: negativePromptInput.value.trim(),
            steps: parseInt(stepsInput.value) || 20,
            cfg_scale: parseFloat(cfgScaleInput.value) || 7.0,
            width: parseInt(widthInput.value) || 512,
            height: parseInt(heightInput.value) || 512,
            checkpoint_name: checkpointSelect.value, // This is the correct parameter name expected by the server
            sampler_name: samplerNameInput.value,
            seed: seedInput.value ? parseInt(seedInput.value) : -1,
            subseed: subseedInput.value ? parseInt(subseedInput.value) : -1,
            batch_size: parseInt(numImagesInput.value) || 1,
            restore_faces: restoreFacesInput.checked,
            enable_hr: enableHiresFixInput.checked,
            style_preset: stylePresetInput.value,
            sampling_category: samplingCategoryInput.value,
            upscaler_model: upscalerModelInput.value !== 'None' ? upscalerModelInput.value : null,
            refiner_model: refinerModelInput.value !== 'None' ? refinerModelInput.value : null,
            scheduler_or_quality_preset: schedulerOrQualityPresetInput.value,
        };
        
        // Add LoRA parameters if any exist
        if (loraParams.length > 0) {
            generationParams.loras = loraParams;
        }
        
        try {
            progressText.innerText = 'Submitting job to queue...';
            
            // Make the API call to generate the image
            const response = await fetch('/api/v1/generate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    target_server_alias: targetServerAlias,
                    generation_params: generationParams
                })
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `Server returned ${response.status}`);
            }
            
            const responseData = await response.json();
            const jobId = responseData.mobilesd_job_id;
            
            if (!jobId) {
                throw new Error('No job ID returned from server');
            }
            
            // Set the current job ID for tracking
            currentJobId = jobId;
            progressText.innerText = `Job queued. Job ID: ${jobId}`;
            progressBar.value = 5; // Show some initial progress
            
            // Subscribe to this job via WebSocket
            if (jobClient) {
                jobClient.subscribeToJob(jobId);
            }
            
            // Get the initial job status to show in UI
            const initialStatusResponse = await fetch(`/api/v1/queue/jobs/${jobId}/status`);
            if (initialStatusResponse.ok) {
                const initialStatus = await initialStatusResponse.json();
                currentJob = initialStatus;
                updateProgressUI(initialStatus);
            }
            
            // Re-enable the generate button
                    generateBtn.disabled = false;
            
        } catch (error) {
            console.error('Error generating image:', error);
            progressText.innerText = `Error: ${error.message}`;
            outputInfo.innerHTML = `<div class="error-message">
                <h3>Error Submitting Job</h3>
                <p>${error.message}</p>
            </div>`;
            
            // Re-enable the generate button
            generateBtn.disabled = false;
        }
    }

    if (generateBtn) {
        generateBtn.addEventListener('click', handleGenerateImageClick);
    }

    // --- INITIALIZATION ---

    // Gallery Functions
    async function loadGalleryImages() {
        if (!galleryImagesContainer) return;
        
        // Show loading state
        galleryImagesContainer.innerHTML = '';
        galleryLoading.style.display = 'block';
        galleryEmpty.style.display = 'none';
        
        try {
            const response = await fetch('/api/v1/gallery/images');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            const images = data.images || [];
            
            // Hide loading, show empty message if needed
            galleryLoading.style.display = 'none';
            
            if (images.length === 0) {
                galleryEmpty.style.display = 'block';
                return;
            }
            
            // Render images
            images.forEach(image => {
                const galleryItem = document.createElement('div');
                galleryItem.className = 'gallery-item';
                galleryItem.dataset.filename = image.filename;
                
                const img = document.createElement('img');
                img.src = `/outputs/${image.filename}`;
                img.alt = image.filename;
                img.loading = 'lazy'; // Lazy load images
                
                const info = document.createElement('div');
                info.className = 'gallery-item-info';
                
                // Format date
                const date = new Date(image.created);
                const formattedDate = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
                
                info.innerHTML = `
                    <div>${image.filename}</div>
                    <div>Created: ${formattedDate}</div>
                `;
                
                galleryItem.appendChild(img);
                galleryItem.appendChild(info);
                
                // Add click handler to open modal
                galleryItem.addEventListener('click', () => {
                    openImageViewer(image.filename);
                });
                
                galleryImagesContainer.appendChild(galleryItem);
            });
            
            // Apply search filter if there's text in the search input
            if (gallerySearchInput && gallerySearchInput.value.trim()) {
                filterGalleryImages(gallerySearchInput.value.trim());
            }
            
        } catch (error) {
            console.error('Error loading gallery images:', error);
            galleryLoading.style.display = 'none';
            galleryImagesContainer.innerHTML = `<div class="error-message">Error loading images: ${error.message}</div>`;
        }
    }
    
    async function openImageViewer(filename) {
        try {
            // Show loading state in modal
            modalImage.src = '';
            modalImageInfo.innerHTML = 'Loading image details...';
            imageViewerModal.style.display = 'flex';
            
            // Fetch image details
            const response = await fetch(`/api/v1/gallery/images/${filename}/info`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const imageInfo = await response.json();
            
            // Set image src
            modalImage.src = `/outputs/${filename}`;
            
            // Format date
            const date = new Date(imageInfo.created);
            const formattedDate = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
            
            // Format file size
            const fileSizeKB = Math.round(imageInfo.size / 1024);
            const fileSizeMB = fileSizeKB > 1024 ? (imageInfo.size / (1024 * 1024)).toFixed(2) + ' MB' : fileSizeKB + ' KB';
            
            // Populate info panel
            modalImageInfo.innerHTML = `
                <h3>${imageInfo.filename}</h3>
                <p><strong>Created:</strong> ${formattedDate}</p>
                <p><strong>Size:</strong> ${fileSizeMB}</p>
                ${imageInfo.job_id_prefix ? `<p><strong>Job ID:</strong> ${imageInfo.job_id_prefix}...</p>` : ''}
            `;
            
            // Update delete button to include filename
            deleteImageBtn.dataset.filename = filename;
            
        } catch (error) {
            console.error('Error fetching image details:', error);
            modalImageInfo.innerHTML = `<div class="error-message">Error loading image details: ${error.message}</div>`;
        }
    }
    
    function filterGalleryImages(searchTerm) {
        if (!galleryImagesContainer) return;
        
        const items = galleryImagesContainer.querySelectorAll('.gallery-item');
        let visibleCount = 0;
        
        searchTerm = searchTerm.toLowerCase();
        
        items.forEach(item => {
            const filename = item.dataset.filename.toLowerCase();
            if (filename.includes(searchTerm)) {
                item.style.display = 'block';
                visibleCount++;
            } else {
                item.style.display = 'none';
            }
        });
        
        // Show empty message if no results
        galleryEmpty.style.display = visibleCount === 0 ? 'block' : 'none';
        galleryEmpty.textContent = visibleCount === 0 ? 'No images matching your search.' : 'No images found.';
    }
    
    // Gallery Event Listeners
    if (refreshGalleryBtn) {
        refreshGalleryBtn.addEventListener('click', loadGalleryImages);
    }
    
    if (gallerySearchInput) {
        gallerySearchInput.addEventListener('input', (e) => {
            filterGalleryImages(e.target.value.trim());
        });
    }
    
    if (deleteImageBtn) {
        deleteImageBtn.addEventListener('click', () => {
            const filename = deleteImageBtn.dataset.filename;
            if (filename && confirm(`Are you sure you want to delete ${filename}?`)) {
                deleteImage(filename);
            }
        });
    }
    
    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', () => {
            imageViewerModal.style.display = 'none';
        });
    }
    
    // Close modal when clicking outside of content
    if (imageViewerModal) {
        imageViewerModal.addEventListener('click', (e) => {
            if (e.target === imageViewerModal) {
                imageViewerModal.style.display = 'none';
            }
        });
    }

    // --- QUEUE FUNCTIONS ---

    // Function to load all jobs from the queue
    async function loadQueueJobs() {
        if (!queueJobsTable || !queueLoading || !queueEmpty) return;
        
        // Show loading state
        queueJobsTable.innerHTML = '';
        queueLoading.style.display = 'block';
        queueEmpty.style.display = 'none';
        
        try {
            // Get filter value if any
            const statusFilter = queueStatusFilter ? queueStatusFilter.value : '';
            
            // Build the URL with filter if needed
            let url = '/api/v1/queue/jobs';
            if (statusFilter) {
                url += `?status=${encodeURIComponent(statusFilter)}`;
            }
            
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            const jobs = data.jobs || [];
            
            // Hide loading
            queueLoading.style.display = 'none';
            
            // Display jobs (or empty message)
            displayQueueJobs(jobs);
            
        } catch (error) {
            console.error('Error loading jobs:', error);
            queueLoading.style.display = 'none';
            queueEmpty.style.display = 'block';
            queueEmpty.innerHTML = `<p>Error loading jobs: ${error.message}</p>`;
        }
    }
    
    // Function to display jobs in the queue table
    function displayQueueJobs(jobs) {
        if (!queueJobsTable || !queueEmpty) return;
        
        // Clear existing rows
        queueJobsTable.innerHTML = '';
        
        // Show empty message if needed
        if (!jobs || jobs.length === 0) {
                queueEmpty.style.display = 'block';
                return;
            }
            
        queueEmpty.style.display = 'none';
        
        // Filter jobs if a status filter is active
        const statusFilter = queueStatusFilter ? queueStatusFilter.value : '';
        const filteredJobs = statusFilter ? 
            jobs.filter(job => job.status.toLowerCase() === statusFilter.toLowerCase()) : 
            jobs;
            
        if (filteredJobs.length === 0) {
            queueEmpty.style.display = 'block';
            queueEmpty.innerHTML = `<p>No jobs with status "${statusFilter}" found.</p>`;
            return;
        }
        
        // Sort jobs by creation timestamp (newest first)
        filteredJobs.sort((a, b) => {
            return new Date(b.creation_timestamp) - new Date(a.creation_timestamp);
        });
            
        // Render each job
        filteredJobs.forEach(job => {
                const row = document.createElement('tr');
            row.id = `job-row-${job.mobilesd_job_id}`;
                row.dataset.jobId = job.mobilesd_job_id;
                
                // Format date
                const created = new Date(job.creation_timestamp);
                const formattedDate = created.toLocaleDateString() + ' ' + created.toLocaleTimeString();
                
                // Create status badge
                const statusBadge = `<span class="job-status job-status-${job.status.toLowerCase()}">${job.status}</span>`;
                
                // Check if we have a progress percentage for 'processing' jobs
                let progressHtml = '';
                let previewHtml = '';
                
                if (job.status === 'processing') {
                // IMPORTANT: Always include progress bar for processing jobs, even if percentage is 0
                // Use progress_percentage if available, otherwise default to 0
                    const progressPercentage = job.result_details?.progress_percentage || 0;
                    progressHtml = `
                        <div class="job-progress-container">
                            <div class="job-progress-bar">
                                <div class="job-progress-bar-fill" style="width: ${progressPercentage}%"></div>
                            </div>
                            <div class="job-progress-text">${progressPercentage.toFixed(1)}%</div>
                        </div>
                    `;
                    
                    // Add preview image if available
                    if (job.result_details && job.result_details.preview_image) {
                        previewHtml = `
                            <div style="margin-top: 0.5rem;">
                            <img src="/outputs/${job.result_details.preview_image}?t=${Date.now()}" 
                                     alt="Preview" 
                                     class="job-preview-image"
                                     loading="lazy">
                            </div>
                        `;
                    }
                }
                
                row.innerHTML = `
                    <td>${job.mobilesd_job_id}</td>
                    <td>
                        ${statusBadge}
                        ${progressHtml}
                        ${previewHtml}
                    </td>
                    <td>${job.target_server_alias || '-'}</td>
                    <td>${formattedDate}</td>
                    <td class="queue-job-actions">
                        <button class="view-job-btn secondary-button">Details</button>
                        ${job.status === 'pending' || job.status === 'processing' ? 
                            `<button class="cancel-job-btn danger-button">Cancel</button>` : 
                            `<button class="delete-job-btn danger-button">Delete</button>`}
                    </td>
                `;
                
                // Add click handler for the entire row
                row.addEventListener('click', (e) => {
                    // Only trigger when not clicking on a button (handled separately)
                    if (!e.target.classList.contains('view-job-btn') && 
                        !e.target.classList.contains('cancel-job-btn') && 
                        !e.target.classList.contains('delete-job-btn')) {
                        openJobDetails(job.mobilesd_job_id);
                    }
                });
                
                // Add button click handlers
                const viewBtn = row.querySelector('.view-job-btn');
                if (viewBtn) {
                    viewBtn.addEventListener('click', (e) => {
                        e.stopPropagation(); // Prevent row click
                        openJobDetails(job.mobilesd_job_id);
                    });
                }
                
                const cancelBtn = row.querySelector('.cancel-job-btn');
                if (cancelBtn) {
                    cancelBtn.addEventListener('click', (e) => {
                        e.stopPropagation(); // Prevent row click
                        cancelJob(job.mobilesd_job_id);
                    });
                }
                
                const deleteBtn = row.querySelector('.delete-job-btn');
                if (deleteBtn) {
                    deleteBtn.addEventListener('click', (e) => {
                        e.stopPropagation(); // Prevent row click
                        deleteJob(job.mobilesd_job_id);
                    });
                }
                
                queueJobsTable.appendChild(row);
        });
    }
    
    // Function to open job details in modal
    async function openJobDetails(jobId) {
        if (!jobDetailsModal || !jobDetailsContent) return;
        
        try {
            // Show loading state
            jobDetailsContent.innerHTML = 'Loading job details...';
            jobDetailsModal.style.display = 'flex';
            
            // Update buttons dataset
            if (cancelJobBtn) cancelJobBtn.dataset.jobId = jobId;
            if (deleteJobBtn) deleteJobBtn.dataset.jobId = jobId;
            if (viewJobResultsBtn) viewJobResultsBtn.dataset.jobId = jobId;
            
            // Fetch job details
            const response = await fetch(`/api/v1/queue/jobs/${jobId}/status`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const job = await response.json();
            
            // Format timestamps
            const created = new Date(job.creation_timestamp).toLocaleString();
            const updated = job.last_updated_timestamp ? new Date(job.last_updated_timestamp).toLocaleString() : '-';
            const completed = job.completion_timestamp ? new Date(job.completion_timestamp).toLocaleString() : '-';
            
            // Show/hide buttons based on job status
            if (cancelJobBtn) {
                cancelJobBtn.style.display = (job.status === 'pending' || job.status === 'processing') ? 'block' : 'none';
            }
            
            if (deleteJobBtn) {
                deleteJobBtn.style.display = (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') ? 'block' : 'none';
            }
            
            if (viewJobResultsBtn) {
                const hasImages = job.result_details && job.result_details.images && job.result_details.images.length > 0;
                viewJobResultsBtn.style.display = (job.status === 'completed' && hasImages) ? 'block' : 'none';
            }
            
            // Generate HTML content
            let html = `
                <div class="job-details-section">
                    <h4>Job Information</h4>
                    <p><strong>ID:</strong> ${job.mobilesd_job_id}</p>
                    <p><strong>Status:</strong> <span class="job-status job-status-${job.status.toLowerCase()}">${job.status}</span></p>
                    <p><strong>Server:</strong> ${job.target_server_alias || '-'}</p>
                    <p><strong>Created:</strong> ${created}</p>
                    <p><strong>Last Updated:</strong> ${updated}</p>
                    <p><strong>Completed:</strong> ${completed}</p>
                `;
            
            // Add progress bar and preview for processing jobs
            if (job.status === 'processing' && job.result_details) {
                const progressPercentage = job.result_details.progress_percentage || 0;
                html += `
                    <div class="job-progress-container" style="margin-top: 1rem;">
                        <div class="job-progress-bar">
                            <div class="job-progress-bar-fill" style="width: ${progressPercentage}%"></div>
                        </div>
                        <div class="job-progress-text">${progressPercentage.toFixed(1)}%</div>
                    </div>
                `;
                
                // Add preview image if available
                if (job.result_details.preview_image) {
                    html += `
                        <div style="margin-top: 1rem; text-align: center;">
                            <img src="/outputs/${job.result_details.preview_image}?t=${Date.now()}" 
                                 alt="Preview" 
                                 class="job-details-preview">
                        </div>
                    `;
                }
            }
            
            html += `</div>`;
            
            // Add generation parameters
            if (job.generation_params) {
                html += `
                    <div class="job-details-section">
                        <h4>Generation Parameters</h4>
                `;
                
                // Format generation parameters nicely with toggles for complex data
                html += formatComplexData(job.generation_params);
                
                html += `</div>`;
            }
            
            // Add result details
            if (job.result_details) {
                html += `
                    <div class="job-details-section">
                        <h4>Result Details</h4>
                `;
                
                // Show images if available
                if (job.result_details.images && job.result_details.images.length > 0) {
                    html += `<p><strong>Images:</strong></p><div class="job-result-images">`;
                    job.result_details.images.forEach(filename => {
                        html += `<img src="/outputs/${filename}" alt="${filename}" title="${filename}" width="150" onclick="openImageViewer('${filename}')">`;
                    });
                    html += `</div>`;
                }
                
                // Show error if failed
                if (job.result_details.error) {
                    html += `<p><strong>Error:</strong> ${job.result_details.error}</p>`;
                    if (job.result_details.details) {
                        html += `<p><strong>Details:</strong> ${job.result_details.details}</p>`;
                    }
                }
                
                // Create a filtered version of result_details without huge data blobs for display
                const filteredDetails = { ...job.result_details };
                
                // Remove large preview images and other potentially large fields from display
                delete filteredDetails.preview_image;
                delete filteredDetails.last_completed_event;
                delete filteredDetails.progress_update;
                delete filteredDetails.progress_estimation;
                
                // Format result details nicely with toggles for complex data
                html += '<h5>Details</h5>';
                html += formatComplexData(filteredDetails, 'result', ['images', 'error', 'details']);
                
                html += `</div>`;
            }
            
            // Update modal content
            jobDetailsContent.innerHTML = html;
            
            // If the job is in processing state, set up a polling interval to update the preview
            if (job.status === 'processing') {
                if (window.jobDetailsInterval) {
                    clearInterval(window.jobDetailsInterval);
                }
                
                window.jobDetailsInterval = setInterval(async () => {
                    if (jobDetailsModal.style.display !== 'flex') {
                        clearInterval(window.jobDetailsInterval);
                        window.jobDetailsInterval = null;
                        return;
                    }
                    
                    try {
                        const response = await fetch(`/api/v1/queue/jobs/${jobId}/status`);
                        if (!response.ok) return;
                        
                        const updatedJob = await response.json();
                        
                        // If job is no longer processing, refresh the entire modal
                        if (updatedJob.status !== 'processing') {
                            openJobDetails(jobId);
                            return;
                        }
                        
                        // Update progress bar
                        const progressBar = jobDetailsContent.querySelector('.job-progress-bar-fill');
                        const progressText = jobDetailsContent.querySelector('.job-progress-text');
                        const progressPercentage = updatedJob.result_details?.progress_percentage || 0;
                        
                        if (progressBar) progressBar.style.width = `${progressPercentage}%`;
                        if (progressText) progressText.textContent = `${progressPercentage.toFixed(1)}%`;
                        
                        // Update preview image if available
                        if (updatedJob.result_details?.preview_image) {
                            let previewImg = jobDetailsContent.querySelector('.job-details-preview');
                            if (previewImg) {
                                // Force refresh by adding a cache-busting query parameter
                                previewImg.src = `/outputs/${updatedJob.result_details.preview_image}?t=${Date.now()}`;
                            } else {
                                // If there was no preview before but now there is, reload the whole modal
                                openJobDetails(jobId);
                            }
                        }
                    } catch (error) {
                        console.error(`Error updating job details for ${jobId}:`, error);
                    }
                }, 1000); // Update every second
            }
            
        } catch (error) {
            console.error('Error fetching job details:', error);
            jobDetailsContent.innerHTML = `<div class="error-message">Error loading job details: ${error.message}</div>`;
        }
    }
    
    // Function to cancel a job
    async function cancelJob(jobId) {
        if (!confirm(`Are you sure you want to cancel job ${jobId}?`)) {
            return;
        }
        
        try {
            const response = await fetch(`/api/v1/queue/jobs/${jobId}/cancel`, {
                method: 'POST'
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            // Close modal if open
            if (jobDetailsModal && jobDetailsModal.style.display === 'flex') {
                jobDetailsModal.style.display = 'none';
                
                // Clear the job details interval if it exists
                if (window.jobDetailsInterval) {
                    clearInterval(window.jobDetailsInterval);
                    window.jobDetailsInterval = null;
                }
            }
            
            // Refresh job list
            loadQueueJobs();
            
            // Show success message
            alert(`Job ${jobId} cancelled successfully.`);
            
        } catch (error) {
            console.error('Error cancelling job:', error);
            alert(`Error cancelling job: ${error.message}`);
        }
    }
    
    // Function to delete a job
    async function deleteJob(jobId) {
        if (!confirm(`Are you sure you want to delete job ${jobId}? This cannot be undone.`)) {
            return;
        }
        
        try {
            const response = await fetch(`/api/v1/queue/jobs/${jobId}`, {
                method: 'DELETE'
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            // Close modal if open
            if (jobDetailsModal && jobDetailsModal.style.display === 'flex') {
                jobDetailsModal.style.display = 'none';
                
                // Clear the job details interval if it exists
                if (window.jobDetailsInterval) {
                    clearInterval(window.jobDetailsInterval);
                    window.jobDetailsInterval = null;
                }
            }
            
            // Refresh job list
            loadQueueJobs();
            
            // Show success message
            alert(`Job ${jobId} deleted successfully.`);
            
        } catch (error) {
            console.error('Error deleting job:', error);
            alert(`Error deleting job: ${error.message}`);
        }
    }
    
    // Function to view job results in the gallery
    function viewJobResults(jobId) {
        // Close the modal
        if (jobDetailsModal) {
            jobDetailsModal.style.display = 'none';
        }
        
        // Fetch job details to get image filenames
        fetch(`/api/v1/queue/jobs/${jobId}/status`)
            .then(response => response.json())
            .then(job => {
                if (job.result_details && job.result_details.images && job.result_details.images.length > 0) {
                    // Switch to gallery view
                    showView('gallery-view', 'nav-gallery');
                    
                    // Load gallery and then open the first image
                    loadGalleryImages().then(() => {
                        // Small delay to ensure gallery is loaded
                        setTimeout(() => {
                            openImageViewer(job.result_details.images[0]);
                        }, 500);
                    });
                } else {
                    alert('No images found for this job.');
                }
            })
            .catch(error => {
                console.error('Error fetching job details for viewing results:', error);
                alert(`Error: ${error.message}`);
            });
    }
    
    // Queue event listeners
    if (refreshQueueBtn) {
        refreshQueueBtn.addEventListener('click', loadQueueJobs);
    }
    
    if (queueStatusFilter) {
        queueStatusFilter.addEventListener('change', loadQueueJobs);
    }
    
    if (cancelJobBtn) {
        cancelJobBtn.addEventListener('click', () => {
            const jobId = cancelJobBtn.dataset.jobId;
            if (jobId) {
                cancelJob(jobId);
            }
        });
    }
    
    if (deleteJobBtn) {
        deleteJobBtn.addEventListener('click', () => {
            const jobId = deleteJobBtn.dataset.jobId;
            if (jobId) {
                deleteJob(jobId);
            }
        });
    }
    
    if (viewJobResultsBtn) {
        viewJobResultsBtn.addEventListener('click', () => {
            const jobId = viewJobResultsBtn.dataset.jobId;
            if (jobId) {
                viewJobResults(jobId);
            }
        });
    }
    
    if (jobDetailsCloseBtn) {
        jobDetailsCloseBtn.addEventListener('click', () => {
            jobDetailsModal.style.display = 'none';
        });
    }
    
    // Close modal when clicking outside of content
    if (jobDetailsModal) {
        jobDetailsModal.addEventListener('click', (e) => {
            if (e.target === jobDetailsModal) {
                jobDetailsModal.style.display = 'none';
            }
        });
    }

    // Initial setup
    fetchAndPopulateServers();
    fetchAndPopulateCheckpoints();
    fetchAndCacheLoras();
    showView('generator-view', 'nav-generator'); // Default view

    // Function to test checkpoint matching
    async function testCheckpointMatching() {
        const serverAlias = document.getElementById('server-alias-select').value;
        const checkpoint = document.getElementById('checkpoint-select').value;
        
        if (!serverAlias || !checkpoint) {
            alert('Please select both a server and checkpoint');
            return;
        }
        
        if (!document.getElementById('checkpoint-debug-modal')) {
            // Create modal if it doesn't exist
            const modal = document.createElement('div');
            modal.id = 'checkpoint-debug-modal';
            modal.className = 'modal';
            modal.innerHTML = `
                <div class="modal-content">
                    <div class="modal-header">
                        <h2>Checkpoint Matching Results</h2>
                        <span class="close">&times;</span>
                    </div>
                    <div class="modal-body">
                        <div id="checkpoint-debug-content">
                            <p>Loading results...</p>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            
            // Add close button functionality
            modal.querySelector('.close').addEventListener('click', () => {
                modal.style.display = 'none';
            });
            
            // Click outside to close
            window.addEventListener('click', (event) => {
                if (event.target === modal) {
                    modal.style.display = 'none';
                }
            });
            
            // Add styles if not already in CSS
            if (!document.getElementById('checkpoint-debug-styles')) {
                const style = document.createElement('style');
                style.id = 'checkpoint-debug-styles';
                style.textContent = `
                    .checkpoint-match-result {
                        margin: 10px 0;
                        padding: 10px;
                        background-color: #f7f7f7;
                        border-radius: 4px;
                    }
                    .match-success {
                        color: green;
                        font-weight: bold;
                    }
                    .match-failure {
                        color: red;
                    }
                    .match-details {
                        margin-top: 10px;
                        font-family: monospace;
                        white-space: pre-wrap;
                        max-height: 300px;
                        overflow-y: auto;
                        background-color: #f0f0f0;
                        padding: 8px;
                        border-radius: 4px;
                    }
                `;
                document.head.appendChild(style);
            }
        }
        
        const modal = document.getElementById('checkpoint-debug-modal');
        const contentDiv = document.getElementById('checkpoint-debug-content');
        
        modal.style.display = 'block';
        contentDiv.innerHTML = '<p>Testing checkpoint match, please wait...</p>';
        
        try {
            const response = await fetch('/api/v1/checkpoint-verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    target_server_alias: serverAlias, 
                    checkpoint_name: checkpoint 
                })
            });
            
            const result = await response.json();
            
            if (!result.success) {
                contentDiv.innerHTML = `
                    <div class="checkpoint-match-result match-failure">
                        <h3>Error Testing Checkpoint</h3>
                        <p>${result.error}</p>
                    </div>
                `;
                return;
            }
            
            const hasBestMatch = !!result.best_match;
            
            contentDiv.innerHTML = `
                <div class="checkpoint-match-result ${hasBestMatch ? 'match-success' : 'match-failure'}">
                    <h3>Match Result: ${hasBestMatch ? 'MATCH FOUND' : 'NO MATCH FOUND'}</h3>
                    <p><strong>Checkpoint Name:</strong> ${result.checkpoint_name}</p>
                    <p><strong>Server:</strong> ${result.server}</p>
                    ${hasBestMatch ? `<p><strong>Best Match:</strong> ${result.best_match}</p>` : ''}
                </div>
                
                <div class="checkpoint-match-result">
                    <h3>Cache Match</h3>
                    ${result.cache_match ? `
                        <p>Found in cache with ID: ${result.cache_match.id}</p>
                        <p>Name: ${result.cache_match.name}</p>
                        <p>Forge Title: ${result.cache_match.forge_title}</p>
                    ` : '<p>No cached match found</p>'}
                </div>
                
                <div class="checkpoint-match-result">
                    <h3>Database Match</h3>
                    ${result.database_match ? `
                        <p>Found in database with ID: ${result.database_match.id}</p>
                        <p>Name: ${result.database_match.name}</p>
                        <p>Forge Format: ${result.database_match.forge_format || 'Not set'}</p>
                    ` : '<p>No database match found</p>'}
                </div>
                
                <div class="checkpoint-match-result">
                    <h3>Match Attempts</h3>
                    <ul>
                        <li>Exact Match: ${result.matching_results.exact_match || 'None'}</li>
                        <li>Forward Slash Match: ${result.matching_results.forward_slash_match || 'None'}</li>
                        <li>Backslash Match: ${result.matching_results.backslash_match || 'None'}</li>
                        <li>Filename Match: ${result.matching_results.filename_match || 'None'}</li>
                    </ul>
                </div>
                
                <div class="checkpoint-match-result">
                    <h3>Available Models Sample (${result.total_models_count} total)</h3>
                    <div class="match-details">
                        ${result.sample_available_models.map(model => `- ${model}`).join('\n')}
                        ${result.total_models_count > 5 ? '\n... and more' : ''}
                    </div>
                </div>
            `;
        } catch (error) {
            contentDiv.innerHTML = `
                <div class="checkpoint-match-result match-failure">
                    <h3>Error Testing Checkpoint</h3>
                    <p>${error.message}</p>
                </div>
            `;
        }
    }

    // Add test button to checkpoint row
    function addCheckpointTestButton() {
        // Make sure elements exist
        const checkpointRow = document.querySelector('#generator-tab .checkpoint-row');
        if (!checkpointRow || checkpointRow.querySelector('#test-checkpoint-btn')) return;
        
        // Create the button
        const testButton = document.createElement('button');
        testButton.id = 'test-checkpoint-btn';
        testButton.className = 'small-button';
        testButton.style.marginLeft = '8px';
        testButton.textContent = 'Test';
        testButton.title = 'Test if this checkpoint can be found on the selected server';
        
        // Find the label to append after
        const checkpointLabel = checkpointRow.querySelector('label');
        if (checkpointLabel) {
            checkpointLabel.appendChild(testButton);
            
            // Add event listener
            testButton.addEventListener('click', (e) => {
                e.preventDefault();
                testCheckpointMatching();
            });
        }
    }

    // This runs when the initial document is ready
    // Add the test button with a delay to ensure the checkpoint row is loaded
    setTimeout(addCheckpointTestButton, 1000);

    /**
     * Helper function to format complex data with toggles for JSON objects and arrays
     * @param {Object} data - The data object to format
     * @param {string} prefix - Prefix for toggle IDs to avoid conflicts
     * @param {string[]} excludeKeys - Array of keys to exclude from the output
     * @return {string} HTML string with formatted data
     */
    function formatComplexData(data, prefix = '', excludeKeys = []) {
        let html = '<ul style="list-style-type: none; padding-left: 0;">';
        
        Object.entries(data).forEach(([key, value]) => {
            // Skip excluded keys
            if (excludeKeys.includes(key)) {
                return;
            }
            
            if (value === null || value === undefined) {
                html += `<li><strong>${key}:</strong> <em>null</em></li>`;
            } else if (Array.isArray(value)) {
                // Format arrays as comma-separated values
                if (value.length === 0) {
                    html += `<li><strong>${key}:</strong> <em>[]</em></li>`;
                } else if (typeof value[0] === 'object') {
                    // Complex array with objects - add a toggle
                    const toggleId = `${prefix}-toggle-${key}-${Date.now()}`;
                    html += `
                        <li>
                            <strong>${key}:</strong> 
                            <a href="#" onclick="document.getElementById('${toggleId}').style.display = document.getElementById('${toggleId}').style.display === 'none' ? 'block' : 'none'; return false;">
                                [${value.length} items] (click to toggle)
                            </a>
                            <pre id="${toggleId}" style="display:none; max-height: 200px; overflow-y: auto;">${JSON.stringify(value, null, 2)}</pre>
                        </li>`;
                } else {
                    // Simple array with primitive values
                    html += `<li><strong>${key}:</strong> [${value.join(', ')}]</li>`;
                }
            } else if (typeof value === 'object') {
                // Format objects with a toggle
                const toggleId = `${prefix}-toggle-${key}-${Date.now()}`;
                html += `
                    <li>
                        <strong>${key}:</strong> 
                        <a href="#" onclick="document.getElementById('${toggleId}').style.display = document.getElementById('${toggleId}').style.display === 'none' ? 'block' : 'none'; return false;">
                            {object} (click to toggle)
                        </a>
                        <pre id="${toggleId}" style="display:none; max-height: 200px; overflow-y: auto;">${JSON.stringify(value, null, 2)}</pre>
                    </li>`;
            } else if (typeof value === 'string' && value.length > 100) {
                // Long string with a toggle
                const toggleId = `${prefix}-toggle-${key}-${Date.now()}`;
                const shortValue = value.substring(0, 100) + '...';
                html += `
                    <li>
                        <strong>${key}:</strong> 
                        <span id="${toggleId}-short">${shortValue}</span>
                        <span id="${toggleId}-full" style="display:none">${value}</span>
                        <a href="#" onclick="
                            document.getElementById('${toggleId}-short').style.display = document.getElementById('${toggleId}-short').style.display === 'none' ? 'inline' : 'none';
                            document.getElementById('${toggleId}-full').style.display = document.getElementById('${toggleId}-full').style.display === 'none' ? 'inline' : 'none';
                            this.textContent = this.textContent === 'Show more' ? 'Show less' : 'Show more';
                            return false;
                        ">Show more</a>
                    </li>`;
            } else {
                // Simple value
                html += `<li><strong>${key}:</strong> ${value}</li>`;
            }
        });
        
        html += '</ul>';
        return html;
    }

    // Models Tab Functions
    async function loadModels() {
        if (!modelsGrid || !modelsLoading || !modelsEmpty) {
            console.error('Models tab elements not found.');
            return;
        }

        modelsGrid.innerHTML = '';
        modelsLoading.style.display = 'block';
        modelsEmpty.style.display = 'none';

        try {
            const response = await fetch('/api/v1/models');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            allModels = data.models || [];
            
            // Extract unique base models for the filter
            baseModelsList = [...new Set(allModels.map(model => model.baseModel || 'Unknown'))];
            populateBaseModelFilter();
            
            // Display the models
            displayModels(allModels);
            
        } catch (error) {
            console.error('Error loading models:', error);
            modelsLoading.style.display = 'none';
            modelsEmpty.textContent = 'Error loading models. Please try again.';
            modelsEmpty.style.display = 'block';
        }
    }

    function populateBaseModelFilter() {
        if (!baseModelFilter) return;
        
        // Clear existing options (except the "All" option)
        while (baseModelFilter.options.length > 1) {
            baseModelFilter.remove(1);
        }
        
        // Add each unique base model
        baseModelsList.sort().forEach(baseModel => {
            const option = document.createElement('option');
            option.value = baseModel;
            option.textContent = baseModel;
            baseModelFilter.appendChild(option);
        });
    }

    function displayModels(models) {
        if (!modelsGrid || !modelsLoading || !modelsEmpty) return;
        
        modelsGrid.innerHTML = '';
        
        if (models.length === 0) {
            modelsLoading.style.display = 'none';
            modelsEmpty.style.display = 'block';
            return;
        }
        
        models.forEach(model => {
            const card = createModelCard(model);
            modelsGrid.appendChild(card);
        });
        
        modelsLoading.style.display = 'none';
    }

    function createModelCard(model) {
        const card = document.createElement('div');
        card.className = 'model-card';
        card.dataset.modelId = model.relativePath ? `${model.relativePath}/${model.filename}` : model.filename;
        card.dataset.modelType = model.type;
        
        // Add civitai flag for styling
        card.dataset.hasCivitai = model.civitai_url ? 'true' : 'false';
        
        // Create preview element
        const preview = document.createElement('div');
        preview.className = 'model-preview';
        
        // Check if there's a preview image available
        if (model.preview_url) {
            const img = document.createElement('img');
            img.src = model.preview_url;
            img.alt = model.filename;
            img.onerror = function() {
                this.style.display = 'none';
                preview.textContent = 'No Preview';
            };
            preview.appendChild(img);
        } else {
            preview.textContent = 'No Preview';
        }
        
        // Create info section
        const info = document.createElement('div');
        info.className = 'model-info';
        
        // Model name
        const name = document.createElement('div');
        name.className = 'model-name';
        name.textContent = model.filename;
        
        // Add description if available
        if (model.description) {
            const description = document.createElement('div');
            description.className = 'model-description';
            description.textContent = model.description;
            info.appendChild(description);
        }
        
        // Model metadata badges
        const meta = document.createElement('div');
        meta.className = 'model-meta';
        
        // Type badge
        const typeBadge = document.createElement('span');
        typeBadge.className = `badge badge-${model.type}`;
        typeBadge.textContent = model.type;
        meta.appendChild(typeBadge);
        
        // Base model badge if available
        if (model.baseModel && model.baseModel !== 'Unknown') {
            const baseBadge = document.createElement('span');
            baseBadge.className = `badge badge-base badge-${model.baseModel.toLowerCase().replace(/\s+/g, '').replace(/\./g, '')}`;
            baseBadge.textContent = model.baseModel;
            meta.appendChild(baseBadge);
        }
        
        // Add elements to the card
        info.appendChild(name);
        info.appendChild(meta);
        card.appendChild(preview);
        card.appendChild(info);
        
        // Add click event to open modal with details
        card.addEventListener('click', () => openModelDetails(card.dataset.modelId, card.dataset.modelType));
        
        return card;
    }

    async function openModelDetails(modelId, modelType) {
        if (!modelDetailsModal) return;
        
        try {
            // Clear previous content
            modelName.textContent = 'Loading...';
            modelTypeBadge.textContent = '';
            modelBaseBadge.textContent = '';
            modelDescription.textContent = '';
            modelDetails.innerHTML = '';
            modelPreviewImage.src = '';
            modelPreviewImage.style.display = 'none';
            modelCivitaiLink.style.display = 'none';
            
            // Show the modal while loading
            modelDetailsModal.style.display = 'block';
            
            // Fetch model details with Civitai data
            const response = await fetch(`/api/v1/models/${encodeURIComponent(modelId)}/info?type=${modelType}&fetchFromCivitai=true`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const model = await response.json();
            
            // Update modal content
            modelName.textContent = model.filename;
            
            // Set type badge
            modelTypeBadge.className = `badge badge-${model.type}`;
            modelTypeBadge.textContent = model.type;
            
            // Set base model badge if available
            if (model.baseModel && model.baseModel !== 'Unknown') {
                modelBaseBadge.className = `badge badge-base badge-${model.baseModel.toLowerCase().replace(/\s+/g, '').replace(/\./g, '')}`;
                modelBaseBadge.textContent = model.baseModel;
                modelBaseBadge.style.display = 'inline-block';
            } else {
                modelBaseBadge.style.display = 'none';
            }
            
            // If we have Civitai data, use it for the description and other details
            let description = '';
            if (model.civitai_data && model.civitai_data.description) {
                description = model.civitai_data.description;
            } else if (model.metadata && model.metadata.description) {
                description = model.metadata.description;
            }
            
            if (description) {
                modelDescription.innerHTML = description;
                modelDescription.style.display = 'block';
            } else {
                modelDescription.style.display = 'none';
            }
            
            // Set preview image
            if (model.has_preview && model.preview_url) {
                modelPreviewImage.src = model.preview_url;
                modelPreviewImage.style.display = 'block';
                modelPreviewImage.onerror = function() {
                    this.style.display = 'none';
                };
            } else if (model.civitai_data && model.civitai_data.images && model.civitai_data.images.length > 0) {
                // Use first Civitai image as preview if local preview not available
                modelPreviewImage.src = model.civitai_data.images[0].url;
                modelPreviewImage.style.display = 'block';
                modelPreviewImage.onerror = function() {
                    this.style.display = 'none';
                };
            }
            
            // Set Civitai link if available
            if (model.civitai_url) {
                modelCivitaiLink.href = model.civitai_url;
                modelCivitaiLink.style.display = 'inline-block';
            } else {
                modelCivitaiLink.style.display = 'none';
            }
            
            // Build details section with key model information
            const dl = document.createElement('dl');
            
            // Add various model details
            const detailsToShow = [
                { term: 'Filename', value: model.filename },
                { term: 'Path', value: model.relativePath || '/' },
                { term: 'Base Model', value: model.baseModel || 'Unknown' },
                { term: 'Size', value: formatFileSize(model.size) },
                { term: 'Created', value: new Date(model.created).toLocaleString() },
                { term: 'Modified', value: new Date(model.modified).toLocaleString() },
            ];
            
            // Add Civitai ID if available
            if (model.civitai_id) {
                detailsToShow.unshift({ 
                    term: 'Civitai ID', 
                    value: model.civitai_id 
                });
            }
            
            // Add any additional metadata from Civitai
            if (model.civitai_data) {
                if (model.civitai_data.tags && model.civitai_data.tags.length) {
                    detailsToShow.push({ 
                        term: 'Tags', 
                        value: model.civitai_data.tags.join(', ') 
                    });
                }
                
                if (model.civitai_data.trainedWords && model.civitai_data.trainedWords.length) {
                    detailsToShow.push({ 
                        term: 'Trigger Words', 
                        value: model.civitai_data.trainedWords.join(', ') 
                    });
                }
                
                // Add model stats if available
                if (model.civitai_data.stats) {
                    if (model.civitai_data.stats.downloadCount) {
                        detailsToShow.push({
                            term: 'Downloads',
                            value: model.civitai_data.stats.downloadCount.toLocaleString()
                        });
                    }
                    
                    if (model.civitai_data.stats.rating) {
                        detailsToShow.push({
                            term: 'Rating',
                            value: `${model.civitai_data.stats.rating.toFixed(2)} / 5 (${model.civitai_data.stats.ratingCount} ratings)`
                        });
                    }
                }
            } else if (model.metadata) {
                // Fallback to local metadata
                if (model.metadata.tags && model.metadata.tags.length) {
                    detailsToShow.push({ 
                        term: 'Tags', 
                        value: model.metadata.tags.join(', ') 
                    });
                }
                
                if (model.metadata.trainedWords && model.metadata.trainedWords.length) {
                    detailsToShow.push({ 
                        term: 'Trigger Words', 
                        value: model.metadata.trainedWords.join(', ') 
                    });
                }
            }
            
            detailsToShow.forEach(detail => {
                if (detail.value) {
                    const dt = document.createElement('dt');
                    dt.textContent = detail.term;
                    
                    const dd = document.createElement('dd');
                    dd.textContent = detail.value;
                    
                    dl.appendChild(dt);
                    dl.appendChild(dd);
                }
            });
            
            modelDetails.appendChild(dl);
            
            // Add refresh metadata button
            const refreshBtn = document.createElement('button');
            refreshBtn.className = 'secondary-button';
            refreshBtn.textContent = 'Refresh Civitai Metadata';
            refreshBtn.style.marginRight = '10px';
            refreshBtn.onclick = () => refreshModelMetadata(modelId, modelType);
            
            // Clear existing actions
            const modelActions = document.getElementById('model-actions');
            while (modelActions.firstChild) {
                modelActions.removeChild(modelActions.firstChild);
            }
            
            // Add buttons to the actions area
            modelActions.appendChild(refreshBtn);
            if (model.civitai_url) {
                modelActions.appendChild(modelCivitaiLink);
            }
            
            // Add Civitai image gallery if available
            if (model.civitai_data && model.civitai_data.images && model.civitai_data.images.length > 1) {
                const gallerySection = document.createElement('div');
                gallerySection.className = 'civitai-image-gallery';
                gallerySection.innerHTML = '<h4>Preview Images</h4>';
                
                const imageGrid = document.createElement('div');
                imageGrid.className = 'civitai-images-grid';
                
                model.civitai_data.images.forEach(image => {
                    const imgContainer = document.createElement('div');
                    imgContainer.className = 'civitai-image-container';
                    
                    const img = document.createElement('img');
                    img.src = image.url;
                    img.alt = 'Model preview';
                    img.loading = 'lazy';
                    img.onclick = () => {
                        window.open(image.url, '_blank');
                    };
                    
                    imgContainer.appendChild(img);
                    imageGrid.appendChild(imgContainer);
                });
                
                gallerySection.appendChild(imageGrid);
                modelDetails.appendChild(gallerySection);
                
                // Add some simple styles for the gallery if they don't exist
                if (!document.getElementById('civitai-gallery-styles')) {
                    const style = document.createElement('style');
                    style.id = 'civitai-gallery-styles';
                    style.textContent = `
                        .civitai-images-grid {
                            display: grid;
                            grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
                            gap: 10px;
                            margin-top: 10px;
                        }
                        .civitai-image-container {
                            cursor: pointer;
                            border-radius: 4px;
                            overflow: hidden;
                            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                            transition: transform 0.2s;
                        }
                        .civitai-image-container:hover {
                            transform: scale(1.05);
                        }
                        .civitai-image-container img {
                            width: 100%;
                            height: 150px;
                            object-fit: cover;
                            display: block;
                        }
                    `;
                    document.head.appendChild(style);
                }
            }
            
        } catch (error) {
            console.error('Error loading model details:', error);
            modelName.textContent = 'Error loading model details';
            modelDetails.innerHTML = `<p class="error">Failed to load model details: ${error.message}</p>`;
        }
    }

    // Function to refresh metadata from Civitai
    async function refreshModelMetadata(modelId, modelType) {
        try {
            const refreshBtn = document.querySelector('#model-actions button');
            if (refreshBtn) {
                refreshBtn.disabled = true;
                refreshBtn.textContent = 'Refreshing...';
            }
            
            const response = await fetch(`/api/v1/models/${encodeURIComponent(modelId)}/refresh-metadata?type=${modelType}`, {
                method: 'POST'
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (result.success) {
                // Reload the model details to show updated info
                await openModelDetails(modelId, modelType);
                alert('Metadata refreshed successfully!');
            } else {
                throw new Error(result.message || 'Unknown error');
            }
        } catch (error) {
            console.error('Error refreshing metadata:', error);
            alert(`Failed to refresh metadata: ${error.message}`);
            
            const refreshBtn = document.querySelector('#model-actions button');
            if (refreshBtn) {
                refreshBtn.disabled = false;
                refreshBtn.textContent = 'Refresh Civitai Metadata';
            }
        }
    }

    function formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    function filterModels() {
        if (!allModels || !allModels.length) return;
        
        const typeFilter = modelTypeFilter ? modelTypeFilter.value : '';
        const baseFilter = baseModelFilter ? baseModelFilter.value : '';
        const searchTerm = modelSearchInput ? modelSearchInput.value.toLowerCase() : '';
        
        const filteredModels = allModels.filter(model => {
            // Filter by type
            if (typeFilter && model.type !== typeFilter) return false;
            
            // Filter by base model
            if (baseFilter && model.baseModel !== baseFilter) return false;
            
            // Filter by search term
            if (searchTerm) {
                const searchable = `${model.filename} ${model.relativePath || ''} ${model.baseModel || ''}`.toLowerCase();
                return searchable.includes(searchTerm);
            }
            
            return true;
        });
        
        displayModels(filteredModels);
    }

    // Models Tab Event Listeners
    if (refreshModelsBtn) {
        refreshModelsBtn.addEventListener('click', loadModels);
    }
    
    if (modelTypeFilter) {
        modelTypeFilter.addEventListener('change', filterModels);
    }
    
    if (baseModelFilter) {
        baseModelFilter.addEventListener('change', filterModels);
    }
    
    if (modelSearchInput) {
        modelSearchInput.addEventListener('input', filterModels);
    }
    
    if (modelDetailsCloseBtn) {
        modelDetailsCloseBtn.addEventListener('click', () => {
            modelDetailsModal.style.display = 'none';
        });
    }
    
    // Close model details modal when clicking outside
    window.addEventListener('click', (event) => {
        if (event.target === modelDetailsModal) {
            modelDetailsModal.style.display = 'none';
        }
    });

    // Initialize WebSocket client when page loads
    initializeJobClient();

    // Function to display completed job images in the output area
    function displayCompletedJobImages(jobStatus) {
        if (!outputImageContainer || !outputInfo) return;
        
        // Clear previous output
        outputImageContainer.innerHTML = '';
        outputInfo.innerHTML = '';
        
        console.log('Displaying completed job images, status:', jobStatus);
        
        const resultDetails = jobStatus.result_details || {};
        
        // Check for images in either field (saved_filenames is the new field, images is legacy)
        const imageFiles = resultDetails.saved_filenames || resultDetails.images || [];
        
        // If we have images but the job is marked as 'failed', it likely succeeded but had an error during cleanup
        // This helps users still see their images even with DB status issues
        if (imageFiles.length > 0 && jobStatus.status === 'failed') {
            console.log('Job is marked as failed but has images. Treating as successful.');
            outputInfo.innerHTML = `<div class="info-message">Job completed with images (${imageFiles.length}), but had an error during cleanup.</div>`;
        }
        
        if (imageFiles.length === 0) {
            // No images found - check if there's an error message
            if (resultDetails.error_message || resultDetails.error) {
                const errorMsg = resultDetails.error_message || resultDetails.error || 'Unknown error occurred';
                console.error('Job error:', errorMsg);
                outputInfo.innerHTML = `<div class="error-message">Error: ${errorMsg}</div>`;
            } else if (jobStatus.status === 'completed') {
                outputInfo.innerHTML = '<div class="warning-message">Job completed but no images were generated.</div>';
            } else {
                outputInfo.innerHTML = `<div class="info-message">Job status: ${jobStatus.status}</div>`;
            }
            return;
        }
        
        // Display all images
        console.log(`Displaying ${imageFiles.length} job images:`, imageFiles);
        
        // Create container for the image(s)
        const imagesContainer = document.createElement('div');
        imagesContainer.className = 'job-images-container';
        
        // Add each image to the container
        imageFiles.forEach(imageName => {
            const imgWrapper = document.createElement('div');
            imgWrapper.className = 'job-image-wrapper';
            
            const img = document.createElement('img');
            img.src = `/outputs/${imageName}`;
            img.alt = 'Generated Image';
            img.className = 'job-output-image';
            
            // Add click handler to show the full-size image
            img.onclick = function() {
                showImageModal(this.src);
            };
            
            imgWrapper.appendChild(img);
            
            // Add download link
            const downloadLink = document.createElement('a');
            downloadLink.href = `/outputs/${imageName}`;
            downloadLink.download = imageName;
            downloadLink.className = 'download-link';
            downloadLink.innerHTML = '<i class="fa fa-download"></i> Download';
            imgWrapper.appendChild(downloadLink);
            
            imagesContainer.appendChild(imgWrapper);
        });
        
        outputImageContainer.appendChild(imagesContainer);
        
        // Display generation info if available
        if (resultDetails.generation_info) {
            let infoHTML = '<div class="generation-info"><h4>Generation Info</h4>';
            
            try {
                // Display generation info as key-value pairs
                const genInfo = typeof resultDetails.generation_info === 'object' 
                    ? resultDetails.generation_info 
                    : JSON.parse(resultDetails.generation_info);
                
                // Format important info at the top
                const importantKeys = ['prompt', 'negative_prompt', 'seed', 'steps', 'sampler_name', 'width', 'height'];
                
                // First show important keys
                importantKeys.forEach(key => {
                    if (genInfo[key] !== undefined) {
                        infoHTML += `<div class="info-row important"><span class="info-label">${key}:</span> <span class="info-value">${genInfo[key]}</span></div>`;
                    }
                });
                
                // Then show other keys
                Object.keys(genInfo).forEach(key => {
                    if (!importantKeys.includes(key) && 
                        typeof genInfo[key] !== 'object' && 
                        genInfo[key] !== null && 
                        genInfo[key] !== undefined) {
                        infoHTML += `<div class="info-row"><span class="info-label">${key}:</span> <span class="info-value">${genInfo[key]}</span></div>`;
                    }
                });
                
                infoHTML += '</div>';
                outputInfo.innerHTML = infoHTML;
            } catch (e) {
                console.error('Error parsing generation info:', e);
                outputInfo.innerHTML = `<div class="generation-info"><pre>${resultDetails.generation_info}</pre></div>`;
            }
        } else {
            // No generation info, just show basic job details
            outputInfo.innerHTML = `
                <div class="generation-info">
                    <div class="info-row"><span class="info-label">Job ID:</span> <span class="info-value">${jobStatus.mobilesd_job_id}</span></div>
                    <div class="info-row"><span class="info-label">Status:</span> <span class="info-value">${jobStatus.status}</span></div>
                    <div class="info-row"><span class="info-label">Target:</span> <span class="info-value">${jobStatus.target_server_alias || 'Unknown'}</span></div>
                    ${resultDetails.positive_prompt ? `<div class="info-row important"><span class="info-label">Prompt:</span> <span class="info-value">${resultDetails.positive_prompt}</span></div>` : ''}
                    ${resultDetails.negative_prompt ? `<div class="info-row important"><span class="info-label">Negative Prompt:</span> <span class="info-value">${resultDetails.negative_prompt}</span></div>` : ''}
                </div>
            `;
        }
    }
});
