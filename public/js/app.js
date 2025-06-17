document.addEventListener('DOMContentLoaded', () => {
    // Server Setup Form Elements
    const serverForm = document.getElementById('server-form');
    const serverAliasInput = document.getElementById('server-alias');
    const serverApiUrlInput = document.getElementById('server-api-url');
    const serverAuthUserInput = document.getElementById('server-auth-user');
    const serverAuthPassInput = document.getElementById('server-auth-pass');
    const editAliasInput = document.getElementById('edit-alias'); // Hidden field for editing
    const saveServerBtn = document.getElementById('save-server-btn');
    const cancelEditBtn = document.getElementById('cancel-edit-btn');

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
    
    // API Keys view elements (we'll use these to trigger data loading)
    const apiKeysView = document.getElementById('api-keys-view');

    // Navigation Elements
    const navQueue = document.getElementById('nav-queue');
    const navGallery = document.getElementById('nav-gallery');
    const navServerSetup = document.getElementById('nav-server-setup');
    const navApiKeys = document.getElementById('nav-api-keys');
    const navModels = document.getElementById('nav-models');
    
    // View Elements
    const queueView = document.getElementById('queue-view');
    const galleryView = document.getElementById('gallery-view');
    const serverSetupView = document.getElementById('server-setup-view');
    const modelsView = document.getElementById('models-view');
    
    // Server list element
    const serverListUL = document.getElementById('server-list');

    let allServersCache = []; // Cache for server data to assist with editing
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
                logJobStatus(job);
                
                // If the job is complete, log it
                if (job.status === 'completed') {
                    console.log('Job completed:', job.mobilesd_job_id);
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
                    // We no longer have the generator progress UI elements
                    console.log(`Job progress update received for current job: ${progress_percentage}%`);
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
        
        // We no longer need to update generator progress UI,
        // but we keep this function for potential future use with the queue
        console.log(`Progress update for job ${job.mobilesd_job_id}: ${job.status}`);
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
                        <strong>Auth:</strong> ${server.authUser ? 'Username/Password' : 'None'}
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

    // Main navigation function
    function showView(viewToShow, buttonToActivate) {
        // Hide all views by removing active class
        [queueView, galleryView, serverSetupView, apiKeysView, modelsView].forEach(v => { 
            if (v) {
                v.classList.remove('active');
                v.style.display = 'none'; // Also clear any inline styles
            }
        });
        // Remove active from all nav buttons
        [navQueue, navGallery, navServerSetup, navApiKeys, navModels].forEach(b => { if (b) b.classList.remove('active'); });
        // Show the selected view and activate the button
        if (viewToShow) {
            viewToShow.classList.add('active');
            viewToShow.style.display = 'block'; // Ensure it's visible
        }
        if (buttonToActivate) buttonToActivate.classList.add('active');
        
        // Load view-specific data
        if (viewToShow === queueView) {
            // Load queue data if we don't have a websocket connection
            if (!jobClient || !jobClient.socket || !jobClient.socket.connected) {
                fetchAndDisplayJobs();
            }
        } else if (viewToShow === galleryView) {
            fetchAndDisplayImages();
        } else if (viewToShow === serverSetupView) {
            fetchAndDisplayServers();
        } else if (viewToShow === apiKeysView) {
            // Trigger API key loading when the view is shown
            if (window.apiKeyManagerUI) {
                window.apiKeyManagerUI.fetchAndDisplayApiKeys();
            }
        } else if (viewToShow === modelsView) {
            // fetchAndDisplayModels will be called by the nav click handler
        }
    }

    // Set up navigation event listeners
    navQueue.addEventListener('click', () => showView(queueView, navQueue));
    navGallery.addEventListener('click', () => showView(galleryView, navGallery));
    navServerSetup.addEventListener('click', () => showView(serverSetupView, navServerSetup));
    navApiKeys.addEventListener('click', () => showView(apiKeysView, navApiKeys));
    if (navModels) {
        navModels.addEventListener('click', () => {
            showView(modelsView, navModels);
            // Show helpful message if no models are cached yet
            if (allModelsCache.length === 0) {
                const container = document.getElementById('models-list');
                if (container) {
                    container.innerHTML = '<div class="no-models-message">Click "Refresh Display" to load your models, or "Scan for New Models" to scan your filesystem.</div>';
                }
            }
        });
    }

    // Queue processing start/stop functionality
    initializeQueueProcessingControls();

    // Initialize the app
    initializeJobClient();
    setupGallerySearch();
    setupGalleryAutoRefresh();
    // Start on queue view by default
    showView(queueView, navQueue);
    
    // Missing functions that are referenced but not defined
    async function fetchAndDisplayJobs() {
        // This function would load jobs for the queue view
        console.log('fetchAndDisplayJobs called - using WebSocket instead');
    }
    
    async function loadQueueJobs() {
        // Force a refresh of queue jobs by making an API call
        try {
            const response = await fetch('/api/v1/queue/jobs');
            if (response.ok) {
                const data = await response.json();
                const jobs = data.jobs || [];
                displayQueueJobs(jobs);
            } else {
                console.error('Failed to load queue jobs:', response.status);
            }
        } catch (error) {
            console.error('Error loading queue jobs:', error);
        }
    }
    
    // Gallery functionality
    async function fetchAndDisplayImages() {
        console.log('Fetching and displaying gallery images...');
        
        const galleryContainer = document.getElementById('gallery-images');
        const galleryLoading = document.getElementById('gallery-loading');
        const galleryEmpty = document.getElementById('gallery-empty');
        
        if (!galleryContainer) {
            console.error('Gallery container not found');
            return;
        }
        
        // Show loading state
        galleryLoading.style.display = 'block';
        galleryEmpty.style.display = 'none';
        galleryContainer.innerHTML = '';
        
        try {
            const response = await fetch('/api/v1/gallery/images');
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            console.log(`Loaded ${data.total} images from gallery`);
            
            // Hide loading state
            galleryLoading.style.display = 'none';
            
            if (data.images && data.images.length > 0) {
                displayGalleryImages(data.images);
            } else {
                galleryEmpty.style.display = 'block';
            }
            
        } catch (error) {
            console.error('Error fetching gallery images:', error);
            galleryLoading.style.display = 'none';
            galleryContainer.innerHTML = `
                <div class="error-container">
                    <p>Error loading gallery: ${error.message}</p>
                    <button onclick="fetchAndDisplayImages()" class="secondary-button">Retry</button>
                </div>
            `;
        }
    }
    
    function displayGalleryImages(images) {
        const galleryContainer = document.getElementById('gallery-images');
        
        galleryContainer.innerHTML = images.map(image => {
            const createdDate = new Date(image.created).toLocaleString();
            const fileSize = formatFileSize(image.size);
            
            return `
                <div class="gallery-item" data-filename="${image.filename}">
                    <div class="gallery-image-container">
                        <img src="/outputs/${image.filename}" 
                             alt="${image.filename}" 
                             loading="lazy"
                             onclick="openImageModal('${image.filename}')">
                    </div>
                    <div class="gallery-item-info">
                        <div class="gallery-filename">${image.filename}</div>
                        <div class="gallery-meta">
                            <span class="gallery-date">${createdDate}</span>
                            <span class="gallery-size">${fileSize}</span>
                            ${image.job_id_prefix ? `<span class="gallery-job-id">Job: ${image.job_id_prefix}...</span>` : ''}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }
    
    function formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    function openImageModal(filename) {
        // Create modal for full-size image viewing
        const modal = document.createElement('div');
        modal.className = 'modal image-modal';
        modal.innerHTML = `
            <div class="modal-content image-modal-content">
                <span class="close-modal">&times;</span>
                <div class="image-modal-body">
                    <img src="/outputs/${filename}" alt="${filename}" class="modal-image">
                    <div class="image-modal-info">
                        <h3>${filename}</h3>
                        <div class="image-modal-actions">
                            <a href="/outputs/${filename}" download="${filename}" class="secondary-button">Download</a>
                            <button onclick="copyImageUrl('${filename}')" class="secondary-button">Copy URL</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        modal.style.display = 'block';
        
        // Close modal when clicking outside or on close button
        modal.addEventListener('click', (e) => {
            if (e.target === modal || e.target.classList.contains('close-modal')) {
                document.body.removeChild(modal);
            }
        });
    }
    
    function copyImageUrl(filename) {
        const url = `${window.location.origin}/outputs/${filename}`;
        navigator.clipboard.writeText(url)
            .then(() => alert('Image URL copied to clipboard!'))
            .catch(err => {
                console.error('Failed to copy URL:', err);
                alert('Failed to copy URL to clipboard');
            });
    }
    
    // Auto-refresh gallery when jobs complete
    function setupGalleryAutoRefresh() {
        // Listen for job completion events
        if (window.jobClient) {
            const originalOnJobUpdate = window.jobClient.onJobUpdate;
            window.jobClient.onJobUpdate = function(callback) {
                const wrappedCallback = (job) => {
                    // Call original callback
                    callback(job);
                    
                    // If job completed and we're on gallery view, refresh gallery
                    if (job.status === 'completed' && 
                        document.getElementById('gallery-view').style.display !== 'none') {
                        console.log(`Job ${job.mobilesd_job_id} completed, refreshing gallery...`);
                        setTimeout(() => fetchAndDisplayImages(), 1000); // Small delay to ensure file is saved
                    }
                };
                
                return originalOnJobUpdate.call(this, wrappedCallback);
            };
        }
    }
    
    // Gallery search functionality
    function setupGallerySearch() {
        const searchInput = document.getElementById('gallery-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const searchTerm = e.target.value.toLowerCase();
                const galleryItems = document.querySelectorAll('.gallery-item');
                
                galleryItems.forEach(item => {
                    const filename = item.dataset.filename.toLowerCase();
                    if (filename.includes(searchTerm)) {
                        item.style.display = 'block';
                    } else {
                        item.style.display = 'none';
                    }
                });
            });
        }
        
        // Refresh gallery button
        const refreshBtn = document.getElementById('refresh-gallery-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', fetchAndDisplayImages);
        }
    }
    
    async function fetchAndPopulateServers() {
        // This function would populate server dropdowns
        console.log('fetchAndPopulateServers called - no dropdown to populate');
    }
    
    function displayQueueJobs(jobs) {
        console.log('displayQueueJobs called with', jobs.length, 'jobs');
        
        const tbody = document.getElementById('queue-jobs');
        const loading = document.getElementById('queue-loading');
        const empty = document.getElementById('queue-empty');
        
        if (!tbody) {
            console.error('Queue jobs tbody not found');
            return;
        }
        
        // Hide loading indicator
        if (loading) loading.style.display = 'none';
        
        // Clear existing rows
        tbody.innerHTML = '';
        
        if (jobs.length === 0) {
            if (empty) empty.style.display = 'block';
            return;
        }
        
        if (empty) empty.style.display = 'none';
        
        // Create rows for each job
        jobs.forEach(job => {
            const row = document.createElement('tr');
            row.id = `job-row-${job.mobilesd_job_id}`;
            row.style.cursor = 'pointer';
            
            // Format creation timestamp
            const createdDate = new Date(job.creation_timestamp).toLocaleString();
            
            // Create status badge with progress if processing
            let statusHtml = `<span class="job-status job-status-${job.status.toLowerCase()}">${job.status}</span>`;
            
            if (job.status === 'processing') {
                const progressPercentage = job.result_details?.progress_percentage || 0;
                statusHtml += `
                    <div class="job-progress-container">
                        <div class="job-progress-bar">
                            <div class="job-progress-bar-fill" style="width: ${progressPercentage}%"></div>
                        </div>
                        <div class="job-progress-text">${progressPercentage.toFixed(1)}%</div>
                    </div>
                `;
                
                // Add preview image if available
                if (job.result_details && job.result_details.preview_image) {
                    statusHtml += `
                        <div style="margin-top: 0.5rem;">
                            <img src="/outputs/${job.result_details.preview_image}?t=${Date.now()}" 
                                 alt="Preview" 
                                 class="job-preview-image"
                                 loading="lazy">
                        </div>
                    `;
                }
            }
            
            // Create checkpoint availability indicator
            let checkpointAvailabilityHtml = '';
            console.log('DEBUG: Job ID:', job.mobilesd_job_id, 'has model_availability:', !!job.model_availability, 'value:', job.model_availability);
            if (job.model_availability) {
                const availability = job.model_availability;
                if (availability.available === true) {
                    checkpointAvailabilityHtml = `
                        <span class="checkpoint-availability checkpoint-available" title="${availability.reason}">
                            ✅ Available
                        </span>
                    `;
                } else if (availability.available === false) {
                    checkpointAvailabilityHtml = `
                        <span class="checkpoint-availability checkpoint-unavailable" title="${availability.reason}">
                            ❌ Unavailable
                        </span>
                    `;
                } else {
                    checkpointAvailabilityHtml = `
                        <span class="checkpoint-availability checkpoint-unknown" title="${availability.reason}">
                            ❓ ${availability.reason || 'Unknown'}
                        </span>
                    `;
                }
                
                // Add additional checkpoint info if available
                if (availability.civitai_model_id) {
                    checkpointAvailabilityHtml += `
                        <div class="checkpoint-info">
                            <small>Civitai ID: ${availability.civitai_model_id}</small>
                            ${availability.civitai_version_id ? `<br><small>Version: ${availability.civitai_version_id}</small>` : ''}
                        </div>
                    `;
                }
            } else {
                checkpointAvailabilityHtml = `
                    <span class="checkpoint-availability checkpoint-unknown" title="Checkpoint availability not checked">
                        ❓ Not checked
                    </span>
                `;
            }
            
            // Create LoRA availability indicator (placeholder for future implementation)
            let loraAvailabilityHtml = '';
            if (job.lora_availability) {
                // TODO: Implement LoRA availability checking similar to checkpoint
                const loraAvailability = job.lora_availability;
                if (loraAvailability.all_available === true) {
                    loraAvailabilityHtml = `
                        <span class="lora-availability lora-available" title="All LoRAs available">
                            ✅ All (${loraAvailability.available_count}/${loraAvailability.total_count})
                        </span>
                    `;
                } else if (loraAvailability.all_available === false) {
                    loraAvailabilityHtml = `
                        <span class="lora-availability lora-unavailable" title="Some LoRAs missing">
                            ❌ ${loraAvailability.available_count}/${loraAvailability.total_count}
                        </span>
                    `;
                } else {
                    loraAvailabilityHtml = `
                        <span class="lora-availability lora-unknown" title="LoRA availability not checked">
                            ❓ Unknown
                        </span>
                    `;
                }
            } else {
                loraAvailabilityHtml = `
                    <span class="lora-availability lora-none" title="No LoRAs detected or not checked">
                        ➖ None/Unknown
                    </span>
                `;
            }
            
            row.innerHTML = `
                <td class="job-id">${job.mobilesd_job_id}</td>
                <td>${statusHtml}</td>
                <td>${checkpointAvailabilityHtml}</td>
                <td>${loraAvailabilityHtml}</td>
                <td>${job.target_server_alias || 'Unknown'}</td>
                <td>${createdDate}</td>
                <td>${job.model_availability?.hash || 'N/A'}</td>
                <td>
                    <div class="queue-job-actions">
                        <button class="secondary-button view-details-btn" data-job-id="${job.mobilesd_job_id}">Details</button>
                        <button class="secondary-button view-params-btn" data-job-id="${job.mobilesd_job_id}">Generation Parameters</button>
                        ${job.status === 'pending' || job.status === 'failed' ? 
                            `<button class="primary-button run-job-btn" data-job-id="${job.mobilesd_job_id}">Run Job</button>` : 
                            ''}
                        ${job.status === 'pending' || job.status === 'processing' ? 
                            `<button class="danger-button cancel-job-btn" data-job-id="${job.mobilesd_job_id}">Cancel</button>` : 
                            ''}
                        ${job.status === 'completed' || job.status === 'failed' ? 
                            `<button class="danger-button delete-job-btn" data-job-id="${job.mobilesd_job_id}">Delete</button>` : 
                            ''}
                    </div>
                </td>
            `;
            
            tbody.appendChild(row);
        });
        
        console.log(`Added ${jobs.length} job rows to queue table`);
        
        // Add event listeners for the new Generation Parameters buttons
        document.querySelectorAll('.view-params-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const jobId = btn.getAttribute('data-job-id');
                showJobParameters(jobId);
            });
        });
        
        // Add event listeners for the Run Job buttons
        document.querySelectorAll('.run-job-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const jobId = btn.getAttribute('data-job-id');
                runJob(jobId, btn);
            });
        });
    }
    
    async function showJobParameters(jobId) {
        try {
            // Fetch job details to get the generation parameters
            const response = await fetch(`/api/v1/queue/jobs/${jobId}/status`);
            if (!response.ok) {
                throw new Error(`Failed to fetch job details: ${response.status}`);
            }
            
            const jobData = await response.json();
            // The API returns job data directly, not wrapped in a "job" property
            const job = jobData;
            
            // Get the modal elements
            const modal = document.getElementById('job-params-modal');
            const content = document.getElementById('job-params-content');
            
            if (!modal || !content) {
                console.error('Job parameters modal elements not found');
                return;
            }
            
            // Parse generation parameters
            let generationParams = {};
            try {
                if (typeof job.generation_params === 'string') {
                    generationParams = JSON.parse(job.generation_params);
                } else if (typeof job.generation_params === 'object') {
                    generationParams = job.generation_params;
                }
            } catch (e) {
                console.error('Error parsing generation parameters:', e);
                generationParams = { error: 'Failed to parse generation parameters', raw: job.generation_params };
            }
            
            // Format the parameters for display
            const formattedParams = formatGenerationParameters(generationParams);
            
            // Display in modal
            content.innerHTML = `
                <div class="job-params-display">
                    <div class="job-params-header">
                        <h4>Job ID: ${job.mobilesd_job_id}</h4>
                        <p><strong>Server:</strong> ${job.target_server_alias || 'Unknown'}</p>
                        <p><strong>Status:</strong> ${job.status}</p>
                        <p><strong>App Type:</strong> ${job.app_type || 'forge'}</p>
                        <p><strong>Source:</strong> ${job.source_info || 'unknown'}</p>
                    </div>
                    <div class="job-params-body">
                        <h4>Generation Parameters:</h4>
                        ${formattedParams}
                    </div>
                    <div class="job-params-raw">
                        <details>
                            <summary>Raw JSON Data</summary>
                            <pre id="raw-params-json">${JSON.stringify(generationParams, null, 2)}</pre>
                        </details>
                    </div>
                </div>
            `;
            
            // Show the modal
            modal.style.display = 'block';
            
            // Store current params for copy/download functionality
            window.currentJobParams = {
                jobId: job.mobilesd_job_id,
                parameters: generationParams
            };
            
        } catch (error) {
            console.error('Error showing job parameters:', error);
            
            // More detailed error information for debugging
            let errorMessage = `Error loading job parameters: ${error.message}`;
            
            // If it's a fetch error, try to provide more context
            if (error.message.includes('Failed to fetch job details')) {
                errorMessage += '\n\nThis could be due to:\n- Job ID not found\n- Network connectivity issues\n- Server is not responding';
            }
            
            alert(errorMessage);
        }
    }
    
    function formatGenerationParameters(params) {
        if (!params || typeof params !== 'object') {
            return '<p>No parameters available</p>';
        }
        
        const sections = {
            'Basic Settings': ['prompt', 'negative_prompt', 'width', 'height', 'steps', 'cfg_scale'],
            'Sampling': ['sampler_name', 'scheduler', 'seed', 'subseed', 'subseed_strength'],
            'Batch Settings': ['batch_size', 'n_iter', 'batch_count'],
            'Advanced': ['restore_faces', 'tiling', 'enable_hr', 'hr_scale', 'hr_upscaler', 'hr_second_pass_steps', 'denoising_strength'],
            'Model & Extensions': ['checkpoint_name', 'sd_model_checkpoint', 'styles', 'script_name', 'script_args'],
            'Override Settings': ['override_settings']
        };
        
        let html = '';
        
        // Display organized sections
        for (const [sectionName, keys] of Object.entries(sections)) {
            const sectionParams = {};
            let hasContent = false;
            
            keys.forEach(key => {
                if (params.hasOwnProperty(key) && params[key] !== null && params[key] !== undefined && params[key] !== '') {
                    sectionParams[key] = params[key];
                    hasContent = true;
                }
            });
            
            if (hasContent) {
                html += `<div class="param-section">`;
                html += `<h5>${sectionName}</h5>`;
                html += `<table class="params-table">`;
                
                for (const [key, value] of Object.entries(sectionParams)) {
                    const displayValue = formatParameterValue(key, value);
                    html += `<tr><td class="param-name">${key}</td><td class="param-value">${displayValue}</td></tr>`;
                }
                
                html += `</table></div>`;
            }
        }
        
        // Display any remaining parameters not in the organized sections
        const usedKeys = Object.values(sections).flat();
        const remainingParams = Object.keys(params).filter(key => !usedKeys.includes(key));
        
        if (remainingParams.length > 0) {
            html += `<div class="param-section">`;
            html += `<h5>Other Parameters</h5>`;
            html += `<table class="params-table">`;
            
            remainingParams.forEach(key => {
                if (params[key] !== null && params[key] !== undefined && params[key] !== '') {
                    const displayValue = formatParameterValue(key, params[key]);
                    html += `<tr><td class="param-name">${key}</td><td class="param-value">${displayValue}</td></tr>`;
                }
            });
            
            html += `</table></div>`;
        }
        
        return html || '<p>No valid parameters found</p>';
    }
    
    function formatParameterValue(key, value) {
        // Handle different types of parameter values
        if (value === null || value === undefined) {
            return '<span class="param-null">null</span>';
        }
        
        if (typeof value === 'boolean') {
            return `<span class="param-boolean">${value}</span>`;
        }
        
        if (typeof value === 'number') {
            return `<span class="param-number">${value}</span>`;
        }
        
        if (typeof value === 'string') {
            if (value.length > 100) {
                return `<div class="param-text-long">${escapeHtml(value)}</div>`;
            }
            return `<span class="param-text">${escapeHtml(value)}</span>`;
        }
        
        if (Array.isArray(value)) {
            if (value.length === 0) {
                return '<span class="param-array-empty">[]</span>';
            }
            return `<div class="param-array"><pre>${JSON.stringify(value, null, 2)}</pre></div>`;
        }
        
        if (typeof value === 'object') {
            return `<div class="param-object"><pre>${JSON.stringify(value, null, 2)}</pre></div>`;
        }
        
        return escapeHtml(String(value));
    }
    
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    function logJobStatus(job) {
        // This function would log job status
        console.log('Job status:', job.mobilesd_job_id, job.status);
    }
    
    // Add event listeners for modal close buttons and copy/download functionality
    document.addEventListener('click', (e) => {
        // Close modals when clicking the close button or outside
        if (e.target.classList.contains('close-modal')) {
            e.target.closest('.modal').style.display = 'none';
        }
        
        // Handle copy parameters button
        if (e.target.id === 'copy-params-btn') {
            if (window.currentJobParams) {
                navigator.clipboard.writeText(JSON.stringify(window.currentJobParams.parameters, null, 2))
                    .then(() => alert('Parameters copied to clipboard!'))
                    .catch(err => {
                        console.error('Failed to copy:', err);
                        alert('Failed to copy parameters to clipboard');
                    });
            }
        }
        
        // Handle download parameters button
        if (e.target.id === 'download-params-btn') {
            if (window.currentJobParams) {
                const blob = new Blob([JSON.stringify(window.currentJobParams.parameters, null, 2)], {
                    type: 'application/json'
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `job-${window.currentJobParams.jobId}-parameters.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }
        }
    });
    
    // Close modals when clicking outside
    window.addEventListener('click', (e) => {
        const modals = document.querySelectorAll('.modal');
        modals.forEach(modal => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });
    });

    // Queue Processing Start/Stop Functions
    function initializeQueueProcessingControls() {
        const startBtn = document.getElementById('start-queue-btn');
        const stopBtn = document.getElementById('stop-queue-btn');
        const statusIndicator = document.getElementById('queue-processing-status');
        
        if (!startBtn || !stopBtn || !statusIndicator) {
            console.warn('Queue processing control elements not found');
            return;
        }

        // Load current settings
        loadQueueProcessingStatus();

        // Add event listeners for Start/Stop buttons
        startBtn.addEventListener('click', async () => {
            await setQueueProcessing(true, startBtn);
        });

        stopBtn.addEventListener('click', async () => {
            await setQueueProcessing(false, stopBtn);
        });
    }

    async function setQueueProcessing(enabled, buttonElement) {
        const originalText = buttonElement.textContent;
        buttonElement.textContent = enabled ? 'Starting...' : 'Stopping...';
        buttonElement.disabled = true;
        
        try {
            const response = await fetch('/api/v1/settings/queue-processing', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ enabled })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            
            if (result.success) {
                updateQueueStatus(enabled);
                console.log(`Queue processing ${enabled ? 'started' : 'stopped'}`);
            } else {
                throw new Error(result.error || 'Failed to update setting');
            }
        } catch (error) {
            console.error('Error updating queue processing:', error);
            alert(`Failed to ${enabled ? 'start' : 'stop'} queue processing: ${error.message}`);
        } finally {
            buttonElement.textContent = originalText;
            buttonElement.disabled = false;
        }
    }

    async function loadQueueProcessingStatus() {
        try {
            const response = await fetch('/api/v1/settings');
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            
            if (result.success && result.settings) {
                const enabled = result.settings.queueProcessingEnabled !== false; // Default to true
                updateQueueStatus(enabled);
            }
        } catch (error) {
            console.error('Error loading queue processing status:', error);
            // Default to enabled if we can't load the setting
            updateQueueStatus(true);
        }
    }

    function updateQueueStatus(enabled) {
        const statusIndicator = document.getElementById('queue-processing-status');
        const startBtn = document.getElementById('start-queue-btn');
        const stopBtn = document.getElementById('stop-queue-btn');
        
        if (statusIndicator) {
            statusIndicator.textContent = enabled ? 'Running' : 'Stopped';
            statusIndicator.className = `status-indicator ${enabled ? 'enabled' : 'disabled'}`;
        }
        
        // Update button states
        if (startBtn && stopBtn) {
            startBtn.disabled = enabled;
            stopBtn.disabled = !enabled;
            startBtn.style.opacity = enabled ? '0.6' : '1';
            stopBtn.style.opacity = !enabled ? '0.6' : '1';
        }
    }

    // Function to manually run a specific job
    async function runJob(jobId, buttonElement) {
        if (!jobId) {
            console.error('Job ID is required to run job');
            return;
        }
        
        // Provide visual feedback
        const originalText = buttonElement.textContent;
        buttonElement.textContent = 'Running...';
        buttonElement.disabled = true;
        buttonElement.style.opacity = '0.6';
        
        try {
            console.log(`Manual dispatch: Running job ${jobId}`);
            
            const response = await fetch(`/api/v1/queue/jobs/${jobId}/dispatch`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                }
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Failed to parse error response' }));
                throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
            }
            
            const result = await response.json();
            console.log(`Job ${jobId} dispatched successfully:`, result);
            
            // Refresh the queue to show updated status
            await loadQueueJobs();
            
        } catch (error) {
            console.error(`Error running job ${jobId}:`, error);
            
            // Restore button state on error
            buttonElement.textContent = originalText;
            buttonElement.disabled = false;
            buttonElement.style.opacity = '1';
            
            // Show detailed error message
            let errorMessage = `Failed to run job ${jobId}: ${error.message}`;
            
            if (error.message.includes('Only \'pending\' and \'failed\' jobs can be dispatched')) {
                errorMessage += '\n\nThe job may have already been completed or is being processed. Please refresh the queue and try again.';
            }
            
            alert(errorMessage);
        }
    }

    // ======================
    // MODELS TAB FUNCTIONALITY
    // ======================
    
    // Cache for models data to prevent redundant filter rebuilding
    let allModelsCache = [];
    let baseModelOptionsCache = new Set();
    let modelsLoadingInProgress = false;
    let renderDebounceTimer = null;
    
    // Function to determine metadata status based on model data
    function getMetadataStatus(model) {
        // If model has civitai_id and civitai_model_name, consider it complete
        if (model.civitai_id && model.civitai_model_name) {
            return 'complete';
        }
        
        // If model has some metadata but not complete
        if (model.civitai_id || model.civitai_model_base || model.civitai_model_type) {
            return 'incomplete';
        }
        
        // No metadata at all
        return 'incomplete';
    }
    
    // Function to determine availability based on model data
    function getAvailabilityStatus(model) {
        // Check if we have server availability data
        if (model.server_availability && Array.isArray(model.server_availability)) {
            return model.server_availability.length > 0;
        }
        
        // Fallback: assume available if model is in database (backward compatibility)
        return true;
    }
    
    // Function to get detailed server availability info
    function getServerAvailabilityInfo(model) {
        if (model.server_availability && Array.isArray(model.server_availability)) {
            return model.server_availability.map(server => ({
                server_id: server.server_id,
                last_seen: server.last_seen
            }));
        }
        return [];
    }
    
    // Function to get availability status text
    function getAvailabilityStatusText(model) {
        const availableServers = getServerAvailabilityInfo(model);
        if (availableServers.length === 0) {
            return 'Not available on any server';
        } else if (availableServers.length === 1) {
            return `Available on 1 server (${availableServers[0].server_id})`;
        } else {
            return `Available on ${availableServers.length} servers`;
        }
    }
    
    // Function to get preview URL for a model
    function getModelPreviewUrl(model) {
        // Use the ready-made preview_url from database (no construction needed)
        return model.preview_url || null;
    }

    // Function to fetch and display models
    async function fetchAndDisplayModels() {
        // Prevent multiple simultaneous calls
        if (modelsLoadingInProgress) {
            console.log('Models loading already in progress, skipping...');
            return;
        }
        
        try {
            modelsLoadingInProgress = true;
            console.log('Fetching models...');
            const response = await fetch('/api/v1/models');
            const data = await response.json();
            
            if (data.success) {
                console.log(`Received ${data.models.length} models from API`);
                
                // Update cache
                allModelsCache = data.models;
                
                // Update base model filter options only if cache has changed
                updateBaseModelFilterOptions();
                
                // Apply current filters and render
                applyFiltersAndRender();
            } else {
                console.error('Failed to fetch models:', data.message);
                const container = document.getElementById('models-list');
                container.innerHTML = '<div class="error-message">Failed to load models: ' + (data.message || 'Unknown error') + '</div>';
            }
        } catch (error) {
            console.error('Error fetching models:', error);
            const container = document.getElementById('models-list');
            container.innerHTML = '<div class="error-message">Error loading models: ' + error.message + '</div>';
        } finally {
            modelsLoadingInProgress = false;
        }
    }

    // Function to update base model filter options (only when needed)
    function updateBaseModelFilterOptions() {
        const newBaseModels = new Set(allModelsCache.map(model => model.civitai_model_base).filter(Boolean));
        
        // Check if options have changed
        const optionsChanged = newBaseModels.size !== baseModelOptionsCache.size || 
            [...newBaseModels].some(model => !baseModelOptionsCache.has(model));
            
        if (optionsChanged) {
            console.log('Updating base model filter options');
            baseModelOptionsCache = newBaseModels;
            
            const baseModelSelect = document.getElementById('model-base-filter');
            const currentValue = baseModelSelect.value;
            
            baseModelSelect.innerHTML = '<option value="all">All</option>';
            [...newBaseModels].sort().forEach(baseModel => {
                const option = document.createElement('option');
                option.value = baseModel;
                option.textContent = baseModel;
                baseModelSelect.appendChild(option);
            });
            
            // Restore previous selection if still valid
            if ([...newBaseModels].includes(currentValue)) {
                baseModelSelect.value = currentValue;
            }
        }
    }

    // Function to apply current filters and render models (with debouncing)
    function applyFiltersAndRender() {
        // Clear any existing debounce timer
        if (renderDebounceTimer) {
            clearTimeout(renderDebounceTimer);
        }
        
        // Debounce the rendering to prevent rapid successive calls
        renderDebounceTimer = setTimeout(() => {
            // Get current filter values
            const typeFilter = document.getElementById('model-type-filter')?.value || 'all';
            const baseModelFilter = document.getElementById('model-base-filter')?.value || 'all';
            const availabilityFilter = document.getElementById('model-availability-filter')?.value || 'all';
            const metadataFilter = document.getElementById('model-metadata-filter')?.value || 'all';
            const searchTerm = document.getElementById('model-search-input')?.value.toLowerCase().trim() || '';
            
            // Filter models
            let filtered = allModelsCache;
            
            // Apply search filter first if there's a search term
            if (searchTerm) {
                filtered = filtered.filter(model => {
                    const searchableText = [
                        model.name || '',
                        model.filename || '',
                        model.type || '',
                        model.civitai_model_base || '',
                        model.civitai_description || '',
                        model.civitai_trained_words || '',
                        model.hash_autov2 || '',
                        model.hash_sha256 || ''
                    ].join(' ').toLowerCase();
                    
                    return searchableText.includes(searchTerm);
                });
            }
            
            if (typeFilter !== 'all') {
                filtered = filtered.filter(model => model.type === typeFilter);
            }
            
            if (baseModelFilter !== 'all') {
                filtered = filtered.filter(model => model.civitai_model_base === baseModelFilter);
            }
            
            if (availabilityFilter !== 'all') {
                filtered = filtered.filter(model => {
                    const isAvailable = getAvailabilityStatus(model);
                    return availabilityFilter === 'available' ? isAvailable : !isAvailable;
                });
            }
            
            if (metadataFilter !== 'all') {
                filtered = filtered.filter(model => {
                    const status = getMetadataStatus(model);
                    return status === metadataFilter;
                });
            }
            
            console.log(`Rendering ${filtered.length} filtered models (search: "${searchTerm}")`);
            
            // Update search results count
            updateSearchResultsCount(filtered.length, allModelsCache.length, searchTerm);
            
            renderModels(filtered);
            renderDebounceTimer = null;
        }, 100); // 100ms debounce delay
    }

    // Function to update search results count display
    function updateSearchResultsCount(filteredCount, totalCount, searchTerm) {
        const countElement = document.getElementById('search-results-count');
        if (!countElement) return;
        
        if (searchTerm) {
            countElement.textContent = `${filteredCount} of ${totalCount} models`;
            countElement.classList.add('has-results');
        } else {
            countElement.textContent = `${totalCount} models`;
            countElement.classList.remove('has-results');
        }
    }

    // Function to highlight search terms in text
    function highlightSearchTerms(text, searchTerm) {
        if (!searchTerm || !text) return text;
        
        const regex = new RegExp(`(${escapeRegex(searchTerm)})`, 'gi');
        return text.replace(regex, '<span class="search-highlight">$1</span>');
    }

    // Function to escape special regex characters
    function escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // Function to render models in the grid
    function renderModels(models) {
        const container = document.getElementById('models-list');
        
        if (!container) {
            console.error('Models container not found');
            return;
        }
        
        container.innerHTML = '';
        
        if (models.length === 0) {
            container.innerHTML = '<div class="no-models-message">No models found matching the current filters.</div>';
            return;
        }
        
        // Get current search term for highlighting
        const searchTerm = document.getElementById('model-search-input')?.value.toLowerCase().trim() || '';
        
        models.forEach(model => {
            const card = document.createElement('div');
            card.className = 'model-card';
            
            // Add NSFW data attribute for blur functionality
            card.dataset.nsfw = model.civitai_nsfw ? 'true' : 'false';
            
            // Safely escape text content and apply search highlighting
            const safeName = escapeHtml(model.name || model.filename || 'Unknown Model');
            const safeType = escapeHtml(model.type || 'Unknown Type');
            const highlightedName = searchTerm ? highlightSearchTerms(safeName, searchTerm) : safeName;
            const highlightedType = searchTerm ? highlightSearchTerms(safeType, searchTerm) : safeType;
            
            // Get model type icon for placeholder
            const typeIcon = model.type === 'lora' ? '🎨' : '🖼️';
            
            // Get preview URL for the model
            const previewUrl = getModelPreviewUrl(model);
            console.log(`Model: ${model.name}, Preview URL: ${previewUrl}`);
            
            // Get AutoV2 hash for display
            const hash = model.hash_autov2 || model.hash_sha256;
            const hashDisplay = hash ? `Hash: ${hash}` : 'No hash calculated';
            
            // Get Civitai URL if available
            const civitaiUrl = model.civitai_id ? `https://civitai.com/models/${model.civitai_id}` : null;
            
            // Set background image or fallback class
            if (previewUrl) {
                console.log(`Setting background image for ${model.name}: ${previewUrl}`);
                card.style.backgroundImage = `url(${previewUrl})`;
            } else {
                console.log(`No preview image for ${model.name}, using fallback`);
                card.classList.add('no-image');
            }
            
            // Create overlay content
            card.innerHTML = `
                ${!previewUrl ? `<div class="model-placeholder-icon">${typeIcon}</div>` : ''}
                <div class="model-card-overlay">
                    <h3 class="model-card-title" title="${safeName}">${highlightedName}</h3>
                    <div class="model-card-hash">${hashDisplay}</div>
                    <div class="model-card-actions">
                        <div class="model-type-badge">${highlightedType}</div>
                        ${civitaiUrl ? `<img src="/civitai-logo.png" class="civitai-logo" title="View on Civitai" onclick="window.open('${civitaiUrl}', '_blank')">` : ''}
                        <img src="/todo-list-icon.png" class="todo-list-icon" title="Retrieve Missing Details" onclick="showRetrieveDetailsModal('${model.id}')">
                    </div>
                </div>
            `;
            
            // Add click event listener to show model details modal
            card.addEventListener('click', (e) => {
                // Don't trigger modal if clicking on action buttons
                if (e.target.classList.contains('civitai-logo') || e.target.classList.contains('todo-list-icon')) {
                    return;
                }
                showModelDetailsModal(model);
            });
            
            container.appendChild(card);
        });
        
        // Apply NSFW blur after rendering
        handleNsfwBlurToggle();
    }

    // Function to handle model scanning
    async function handleModelScan() {
        const scanBtn = document.getElementById('scan-models-btn');
        if (!scanBtn) return;
        
        // Get hash calculation option
        const calculateHashesCheckbox = document.getElementById('calculate-hashes-checkbox');
        const calculateHashes = calculateHashesCheckbox ? calculateHashesCheckbox.checked : false;
        
        scanBtn.disabled = true;
        const originalText = scanBtn.textContent;
        scanBtn.textContent = calculateHashes ? 'Scanning + Calculating Hashes...' : 'Scanning...';
        
        try {
            console.log('Starting model scan...', { calculateHashes });
            const response = await fetch('/api/v1/models/scan', { 
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ calculateHashes })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.success) {
                console.log('Scan complete!', data);
                
                // Use the detailed message from backend if available
                const message = data.message || 
                    `Found ${data.stats?.total || 0} models (${data.stats?.checkpoints || 0} checkpoints, ${data.stats?.loras || 0} LoRAs)`;
                
                // Refresh models display
                await fetchAndDisplayModels();
                
                // Show success message (you can enhance this with a toast notification)
                alert(`Scan complete! ${message}`);
            } else {
                throw new Error(data.message || 'Scan failed');
            }
        } catch (error) {
            console.error('Model scan failed:', error);
            alert('Scan failed: ' + error.message);
        } finally {
            scanBtn.disabled = false;
            scanBtn.textContent = originalText;
        }
    }

    // Function to handle Civitai fetch for individual models
    async function handleCivitaiFetch(event) {
        const button = event.target;
        const modelId = button.dataset.modelId;
        
        if (!modelId) {
            console.error('No model ID found for Civitai fetch');
            return;
        }
        
        button.disabled = true;
        const originalText = button.textContent;
        button.textContent = '🔄 Fetching...';
        
        try {
            console.log(`Fetching Civitai metadata for model ID: ${modelId}`);
            const response = await fetch(`/api/v1/models/${modelId}/fetch-from-civitai`, { 
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.success) {
                console.log('Civitai fetch complete!', data);
                
                // Show success message with details
                const metadata = data.metadata;
                let successMessage = `Successfully fetched metadata from Civitai!\n\n`;
                successMessage += `Model: ${metadata.model_name}\n`;
                successMessage += `Version: ${metadata.version_name}\n`;
                successMessage += `Base Model: ${metadata.base_model}\n`;
                if (metadata.preview_downloaded) {
                    successMessage += `✅ Preview image downloaded\n`;
                }
                if (metadata.trained_words?.length > 0) {
                    successMessage += `Trigger words: ${metadata.trained_words.join(', ')}\n`;
                }
                
                alert(successMessage);
                
                // Refresh models display to show updated information
                await fetchAndDisplayModels();
            } else {
                throw new Error(data.message || 'Civitai fetch failed');
            }
        } catch (error) {
            console.error('Civitai fetch failed:', error);
            alert('Failed to fetch from Civitai: ' + error.message);
        } finally {
            button.disabled = false;
            button.textContent = originalText;
        }
    }

    // Function to handle hash calculation for individual models
    async function handleHashCalculation(event) {
        const button = event.target;
        const modelId = button.dataset.modelId;
        
        if (!modelId) {
            console.error('No model ID found for hash calculation');
            return;
        }
        
        try {
            // First get hash info to check file size and show warnings
            const infoResponse = await fetch(`/api/v1/models/${modelId}/hash-info`);
            
            if (!infoResponse.ok) {
                throw new Error(`Failed to get model info: ${infoResponse.status}`);
            }
            
            const infoData = await infoResponse.json();
            
            if (!infoData.success) {
                throw new Error(infoData.message || 'Failed to get model info');
            }
            
            const fileInfo = infoData.fileInfo;
            
            // Check if hash calculation is allowed
            if (!fileInfo.canCalculateHash) {
                alert(`Cannot calculate hash: ${fileInfo.reason}`);
                return;
            }
            
            // Show confirmation dialog with file size and time estimate
            let confirmMessage = `Calculate AutoV2 hash for this model?\n\n`;
            confirmMessage += `File size: ${fileInfo.size}\n`;
            if (fileInfo.estimatedTimeDisplay) {
                confirmMessage += `Estimated time: ${fileInfo.estimatedTimeDisplay}\n`;
            }
            confirmMessage += `\nThis operation cannot be cancelled once started.`;
            
            if (!confirm(confirmMessage)) {
                return;
            }
            
            // Start hash calculation
            button.disabled = true;
            const originalText = button.textContent;
            button.textContent = '🔄 Calculating...';
            
            console.log(`Starting hash calculation for model ID: ${modelId}`);
            const response = await fetch(`/api/v1/models/${modelId}/calculate-hash`, { 
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.success) {
                console.log('Hash calculation complete!', data);
                
                // Show success message with details
                let successMessage = `Hash calculated successfully!\n\n`;
                successMessage += `AutoV2: ${data.hash}\n`;
                successMessage += `File size: ${data.fileSize}\n`;
                successMessage += `Calculation time: ${data.calculationTime}`;
                
                alert(successMessage);
                
                // Refresh models display to show updated information
                await fetchAndDisplayModels();
            } else {
                throw new Error(data.message || 'Hash calculation failed');
            }
        } catch (error) {
            console.error('Hash calculation failed:', error);
            alert('Hash calculation failed: ' + error.message);
        } finally {
            button.disabled = false;
            button.textContent = button.textContent.includes('Calculating') ? '🔍 Calculate Hash' : button.textContent;
        }
    }

    // Function to show the database reset confirmation modal
    function showResetDatabaseModal() {
        const modal = document.getElementById('reset-database-modal');
        if (modal) {
            modal.style.display = 'block';
        }
    }

    // Function to hide the database reset modal
    function hideResetDatabaseModal() {
        const modal = document.getElementById('reset-database-modal');
        if (modal) {
            modal.style.display = 'none';
        }
    }

    // Function to handle the actual database reset
    async function handleDatabaseReset() {
        const confirmBtn = document.getElementById('confirm-reset-db-btn');
        if (!confirmBtn) return;
        
        confirmBtn.disabled = true;
        const originalText = confirmBtn.textContent;
        confirmBtn.textContent = 'Resetting...';
        
        try {
            console.log('Starting database reset...');
            const response = await fetch('/api/v1/models/reset-database', { 
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.success) {
                console.log('Database reset complete!', data);
                
                // Hide the modal
                hideResetDatabaseModal();
                
                // Refresh models display to show empty state
                await fetchAndDisplayModels();
                
                // Show success message
                alert('Models database has been reset successfully! A backup was created before the reset.');
            } else {
                throw new Error(data.message || 'Database reset failed');
            }
        } catch (error) {
            console.error('Database reset failed:', error);
            alert('Database reset failed: ' + error.message);
        } finally {
            confirmBtn.disabled = false;
            confirmBtn.textContent = originalText;
        }
    }

    // Initialize models functionality
    function initializeModelsTab() {
        console.log('Initializing models tab...');
        
        // Set up filter event listeners
        const filterIds = [
            'model-type-filter',
            'model-base-filter',
            'model-availability-filter',
            'model-metadata-filter'
        ];
        
        filterIds.forEach(filterId => {
            const element = document.getElementById(filterId);
            if (element) {
                element.addEventListener('change', applyFiltersAndRender);
            } else {
                console.warn(`Filter element ${filterId} not found`);
            }
        });

        // Set up search functionality
        const searchInput = document.getElementById('model-search-input');
        const clearSearchBtn = document.getElementById('clear-search-btn');
        
        if (searchInput) {
            // Search as user types (with debounce already handled in applyFiltersAndRender)
            searchInput.addEventListener('input', () => {
                const searchTerm = searchInput.value.trim();
                
                // Show/hide clear button
                if (clearSearchBtn) {
                    clearSearchBtn.style.display = searchTerm ? 'flex' : 'none';
                }
                
                // Apply filters with search
                applyFiltersAndRender();
            });
            
            // Handle Enter key
            searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    applyFiltersAndRender();
                }
            });
        }
        
        if (clearSearchBtn) {
            clearSearchBtn.addEventListener('click', () => {
                if (searchInput) {
                    searchInput.value = '';
                    searchInput.focus();
                    clearSearchBtn.style.display = 'none';
                    applyFiltersAndRender();
                }
            });
        }
        
        // Set up scan button
        // Setup models controls
        const refreshBtn = document.getElementById('refresh-models-btn');
        const scanBtn = document.getElementById('scan-models-btn');
        const resetDbBtn = document.getElementById('reset-models-db-btn');
        
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                console.log('Refreshing models display...');
                fetchAndDisplayModels();
            });
        }
        
        if (scanBtn) {
            scanBtn.addEventListener('click', handleModelScan);
        } else {
            console.warn('Scan button not found');
        }
        
        if (resetDbBtn) {
            resetDbBtn.addEventListener('click', showResetDatabaseModal);
        } else {
            console.warn('Reset database button not found');
        }
        
        // Setup reset database modal event listeners
        const resetModal = document.getElementById('reset-database-modal');
        const confirmResetBtn = document.getElementById('confirm-reset-db-btn');
        const cancelResetBtn = document.getElementById('cancel-reset-db-btn');
        const closeModalBtn = resetModal?.querySelector('.close-modal');
        
        if (confirmResetBtn) {
            confirmResetBtn.addEventListener('click', handleDatabaseReset);
        }
        
        if (cancelResetBtn) {
            cancelResetBtn.addEventListener('click', hideResetDatabaseModal);
        }
        
        if (closeModalBtn) {
            closeModalBtn.addEventListener('click', hideResetDatabaseModal);
        }
        
        // Close modal when clicking outside of it
        if (resetModal) {
            resetModal.addEventListener('click', (e) => {
                if (e.target === resetModal) {
                    hideResetDatabaseModal();
                }
            });
        }
        
        // Setup NSFW blur toggle
        const blurNsfwCheckbox = document.getElementById('blur-nsfw-checkbox');
        if (blurNsfwCheckbox) {
            blurNsfwCheckbox.addEventListener('change', handleNsfwBlurToggle);
            // Apply initial blur state
            handleNsfwBlurToggle();
        }

        // Check and display Civitai API status
        checkCivitaiApiStatus();

        // No need for additional nav click handler - it's already handled in main nav setup
    }

    // Function to check Civitai API status and display username
    async function checkCivitaiApiStatus() {
        const statusElement = document.getElementById('civitai-api-status');
        if (!statusElement) return;

        try {
            const response = await fetch('/api/v1/civitai/user-info');
            const data = await response.json();

            if (data.success && data.username) {
                statusElement.textContent = `Civitai API key valid for ${data.username}`;
                statusElement.style.display = 'inline';
                statusElement.style.color = 'var(--accent-primary)';
            } else {
                statusElement.textContent = 'Civitai API key not configured';
                statusElement.style.display = 'inline';
                statusElement.style.color = 'var(--text-muted)';
            }
        } catch (error) {
            console.warn('Failed to check Civitai API status:', error);
            statusElement.textContent = 'Civitai API key not configured';
            statusElement.style.display = 'inline';
            statusElement.style.color = 'var(--text-muted)';
        }
    }

    // Initialize models tab (this will be called from the main initialization)
    initializeModelsTab();

    // Function to check model availability and show warnings
    async function checkModelAvailabilityAndWarn(modelHash, modelName = 'Unknown Model') {
        if (!modelHash) {
            return {
                available: false,
                reason: 'No model hash provided',
                showWarning: false  // Don't show warning for missing hash
            };
        }
        
        try {
            const response = await fetch('/api/v1/checkpoint-verify', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    civitai_version_id: modelHash  // API still uses this parameter name but now expects hash
                })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            return {
                available: data.available === true,
                reason: data.reason || 'Unknown',
                hash: data.hash,
                matchType: data.match_type,
                modelInfo: data.model_info,
                showWarning: true
            };
        } catch (error) {
            console.error('Error checking model availability:', error);
            return {
                available: false,
                reason: 'Error checking availability: ' + error.message,
                showWarning: true
            };
        }
    }
    
    // Function to display model availability warning dialog
    function showModelAvailabilityWarning(availabilityResult, modelName, onProceed, onCancel) {
        const { available, reason, hash, matchType, modelInfo } = availabilityResult;
        
        // Create modal content
        const warningContent = `
            <div class="availability-warning">
                <div class="warning-icon">⚠️</div>
                <h3>Model Availability Warning</h3>
                <div class="warning-details">
                    <p><strong>Model:</strong> ${escapeHtml(modelName)}</p>
                    <p><strong>Status:</strong> ${available ? '✅ Available' : '❌ Not Available'}</p>
                    <p><strong>Details:</strong> ${escapeHtml(reason)}</p>
                    ${hash ? `<p><strong>Hash:</strong> ${escapeHtml(hash)} (${matchType || 'unknown type'})</p>` : ''}
                    ${modelInfo ? `
                        <div class="model-details">
                            <p><strong>Found in database:</strong> ${escapeHtml(modelInfo.name || 'Unknown')}</p>
                            <p><strong>Filename:</strong> ${escapeHtml(modelInfo.filename || 'Unknown')}</p>
                            ${modelInfo.hash_autov2 ? `<p><strong>AutoV2 Hash:</strong> ${escapeHtml(modelInfo.hash_autov2)}</p>` : ''}
                            ${modelInfo.hash_sha256 ? `<p><strong>SHA256 Hash:</strong> ${escapeHtml(modelInfo.hash_sha256)}</p>` : ''}
                        </div>
                    ` : ''}
                </div>
                <div class="warning-actions">
                    ${available ? 
                        '<button id="proceed-btn" class="primary-button">Proceed with Job</button>' : 
                        '<button id="proceed-anyway-btn" class="danger-button">Submit Anyway (Job may fail)</button>'
                    }
                    <button id="cancel-btn" class="secondary-button">Cancel</button>
                </div>
            </div>
        `;
        
        // Show modal
        showGenericModal('Model Availability Check', warningContent);
        
        // Add event listeners
        const proceedBtn = document.getElementById(available ? 'proceed-btn' : 'proceed-anyway-btn');
        const cancelBtn = document.getElementById('cancel-btn');
        
        if (proceedBtn) {
            proceedBtn.addEventListener('click', () => {
                hideGenericModal();
                if (onProceed) onProceed();
            });
        }
        
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                hideGenericModal();
                if (onCancel) onCancel();
            });
        }
    }
    
    // Generic modal functions
    function showGenericModal(title, content) {
        // Remove existing modal if any
        let existingModal = document.getElementById('generic-modal');
        if (existingModal) {
            existingModal.remove();
        }
        
        // Create modal
        const modal = document.createElement('div');
        modal.id = 'generic-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <span class="close-modal">&times;</span>
                <div class="modal-body">
                    <h3>${escapeHtml(title)}</h3>
                    ${content}
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        modal.style.display = 'block';
        
        // Add close event listener
        const closeBtn = modal.querySelector('.close-modal');
        if (closeBtn) {
            closeBtn.addEventListener('click', hideGenericModal);
        }
        
        // Close on outside click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                hideGenericModal();
            }
        });
    }
    
    // Make hideGenericModal globally accessible
    window.hideGenericModal = function() {
        const modal = document.getElementById('generic-modal');
        if (modal) {
            modal.style.display = 'none';
            modal.remove();
        }
    };

    // Show retrieve details modal - make it globally accessible
    window.showRetrieveDetailsModal = function(modelId) {
        const modalContent = `
            <div style="margin: 1rem 0;">
                <div style="margin-bottom: 0.75rem;">
                    <label style="display: flex; align-items: center; cursor: pointer;">
                        <input type="checkbox" style="margin-right: 0.5rem;"> Get Preview Image from Civitai
                    </label>
                </div>
                <div style="margin-bottom: 0.75rem;">
                    <label style="display: flex; align-items: center; cursor: pointer;">
                        <input type="checkbox" style="margin-right: 0.5rem;"> Generate Missing Hash
                    </label>
                </div>
                <div style="margin-bottom: 0.75rem;">
                    <label style="display: flex; align-items: center; cursor: pointer;">
                        <input type="checkbox" style="margin-right: 0.5rem;"> Rescan File
                    </label>
                </div>
                <div style="margin-bottom: 0.75rem;">
                    <label style="display: flex; align-items: center; cursor: pointer;">
                        <input type="checkbox" style="margin-right: 0.5rem;"> Retrieve Details From Civitai
                    </label>
                </div>
            </div>
            <div style="display: flex; justify-content: center; gap: 1rem; margin-top: 1.5rem;">
                <button onclick="hideGenericModal()" style="padding: 0.5rem 1rem; background: var(--bg-secondary); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: 4px; cursor: pointer;">Cancel</button>
                <button onclick="hideGenericModal()" style="padding: 0.5rem 1rem; background: var(--accent-primary); border: none; color: white; border-radius: 4px; cursor: pointer;">OK</button>
            </div>
        `;
        
        showGenericModal('Retrieve Missing Details', modalContent);
    };

    // Handle NSFW blur toggle
    function handleNsfwBlurToggle() {
        const blurNsfwCheckbox = document.getElementById('blur-nsfw-checkbox');
        const shouldBlur = blurNsfwCheckbox ? blurNsfwCheckbox.checked : true;
        
        // Apply blur to all NSFW model cards
        const modelCards = document.querySelectorAll('.model-card');
        modelCards.forEach(card => {
            const isNsfw = card.dataset.nsfw === 'true';
            if (isNsfw && shouldBlur) {
                card.classList.add('nsfw-blurred');
            } else {
                card.classList.remove('nsfw-blurred');
            }
        });
    }

    // Function to show model details modal
    function showModelDetailsModal(model) {
        const modal = document.getElementById('model-details-modal');
        const title = document.getElementById('model-details-title');
        const img = document.getElementById('model-details-img');
        const placeholder = document.getElementById('model-details-placeholder');
        const fieldsContainer = document.getElementById('model-details-fields');
        
        if (!modal || !title || !img || !placeholder || !fieldsContainer) {
            console.error('Modal elements not found');
            return;
        }
        
        // Set the model name
        title.textContent = model.name || model.filename || 'Unknown Model';
        
        // Handle preview image
        const previewUrl = getModelPreviewUrl(model);
        if (previewUrl) {
            img.src = previewUrl;
            img.style.display = 'block';
            placeholder.style.display = 'none';
        } else {
            img.style.display = 'none';
            placeholder.style.display = 'flex';
        }
        
        // Populate model fields
        populateModelFields(model, fieldsContainer);
        
        // Show the modal
        modal.style.display = 'block';
        
        // Add escape key listener
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                hideModelDetailsModal();
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);
    }
    
    // Function to hide model details modal
    function hideModelDetailsModal() {
        const modal = document.getElementById('model-details-modal');
        if (modal) {
            modal.style.display = 'none';
        }
    }
    
    // Function to populate model fields in the modal
    function populateModelFields(model, container) {
        // Define all possible database fields with friendly names
        const fieldDefinitions = [
            { key: 'id', label: 'Database ID', type: 'number' },
            { key: 'filename', label: 'Filename', type: 'text' },
            { key: 'type', label: 'Model Type', type: 'text' },
            { key: 'local_path', label: 'Local Path', type: 'text' },
            { key: 'hash_autov2', label: 'AutoV2 Hash', type: 'hash' },
            { key: 'hash_sha256', label: 'SHA256 Hash', type: 'hash' },
            { key: 'civitai_id', label: 'Civitai Model ID', type: 'text' },
            { key: 'civitai_version_id', label: 'Civitai Version ID', type: 'text' },
            { key: 'civitai_model_name', label: 'Civitai Model Name', type: 'text' },
            { key: 'civitai_model_base', label: 'Base Model', type: 'text' },
            { key: 'civitai_model_type', label: 'Civitai Type', type: 'text' },
            { key: 'civitai_model_version_name', label: 'Version Name', type: 'text' },
            { key: 'civitai_model_version_desc', label: 'Version Description', type: 'text' },
            { key: 'civitai_model_version_date', label: 'Version Date', type: 'date' },
            { key: 'civitai_download_url', label: 'Download URL', type: 'url' },
            { key: 'civitai_trained_words', label: 'Trigger Words', type: 'text' },
            { key: 'civitai_file_size_kb', label: 'File Size (KB)', type: 'number' },
            { key: 'civitai_nsfw', label: 'NSFW Content', type: 'boolean' },
            { key: 'civitai_blurhash', label: 'Blur Hash', type: 'text' },
            { key: 'metadata_status', label: 'Metadata Status', type: 'text' },
            { key: 'metadata_source', label: 'Metadata Source', type: 'text' },
            { key: 'has_embedded_metadata', label: 'Has Embedded Metadata', type: 'boolean' },
            { key: 'last_used', label: 'Last Used', type: 'date' },
            { key: 'created_at', label: 'Created At', type: 'date' }
        ];
        
        // Clear existing fields
        container.innerHTML = '';
        
        // Create fields for each defined field
        fieldDefinitions.forEach(field => {
            const fieldDiv = document.createElement('div');
            fieldDiv.className = 'model-field';
            
            const labelDiv = document.createElement('div');
            labelDiv.className = 'model-field-label';
            labelDiv.textContent = field.label;
            
            const valueDiv = document.createElement('div');
            valueDiv.className = 'model-field-value';
            
            const value = model[field.key];
            
            if (value === null || value === undefined || value === '') {
                valueDiv.textContent = 'Not set';
                valueDiv.classList.add('null-value');
            } else {
                switch (field.type) {
                    case 'hash':
                        valueDiv.textContent = value;
                        valueDiv.classList.add('hash-value');
                        break;
                    case 'url':
                        valueDiv.textContent = value;
                        valueDiv.classList.add('url-value');
                        valueDiv.addEventListener('click', () => window.open(value, '_blank'));
                        break;
                    case 'boolean':
                        valueDiv.textContent = value ? 'Yes' : 'No';
                        break;
                    case 'date':
                        if (value) {
                            try {
                                const date = new Date(value);
                                valueDiv.textContent = date.toLocaleString();
                            } catch (e) {
                                valueDiv.textContent = value;
                            }
                        } else {
                            valueDiv.textContent = 'Not set';
                            valueDiv.classList.add('null-value');
                        }
                        break;
                    case 'number':
                        valueDiv.textContent = Number(value).toLocaleString();
                        break;
                    default:
                        valueDiv.textContent = value;
                }
            }
            
            fieldDiv.appendChild(labelDiv);
            fieldDiv.appendChild(valueDiv);
            container.appendChild(fieldDiv);
        });
    }
    
    // Add event listeners for modal close functionality
    const modelModal = document.getElementById('model-details-modal');
    if (modelModal) {
        // Close modal when clicking the X button
        const closeBtn = modelModal.querySelector('.close-modal');
        if (closeBtn) {
            closeBtn.addEventListener('click', hideModelDetailsModal);
        }
        
        // Close modal when clicking outside of it
        modelModal.addEventListener('click', (e) => {
            if (e.target === modelModal) {
                hideModelDetailsModal();
            }
        });
        
        // OK and Cancel buttons both close the modal for now
        const okBtn = document.getElementById('model-details-ok-btn');
        const cancelBtn = document.getElementById('model-details-cancel-btn');
        
        if (okBtn) {
            okBtn.addEventListener('click', hideModelDetailsModal);
        }
        
        if (cancelBtn) {
            cancelBtn.addEventListener('click', hideModelDetailsModal);
        }
    }
});
