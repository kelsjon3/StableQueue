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
    
    // View Elements
    const queueView = document.getElementById('queue-view');
    const galleryView = document.getElementById('gallery-view');
    const serverSetupView = document.getElementById('server-setup-view');
    
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
        // Hide all views
        queueView.style.display = 'none';
        galleryView.style.display = 'none';
        serverSetupView.style.display = 'none';
        apiKeysView.style.display = 'none';
        
        // Remove active class from all buttons
        navQueue.classList.remove('active');
        navGallery.classList.remove('active');
        navServerSetup.classList.remove('active');
        navApiKeys.classList.remove('active');
        
        // Show selected view and activate the button
        viewToShow.style.display = 'block';
        buttonToActivate.classList.add('active');
        
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
        }
    }

    // Set up navigation event listeners
    navQueue.addEventListener('click', () => showView(queueView, navQueue));
    navGallery.addEventListener('click', () => showView(galleryView, navGallery));
    navServerSetup.addEventListener('click', () => showView(serverSetupView, navServerSetup));
    navApiKeys.addEventListener('click', () => showView(apiKeysView, navApiKeys));

    // Queue processing toggle functionality
    initializeQueueProcessingToggle();

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
            
            row.innerHTML = `
                <td class="job-id">${job.mobilesd_job_id}</td>
                <td>${statusHtml}</td>
                <td>${job.target_server_alias || 'Unknown'}</td>
                <td>${createdDate}</td>
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

    // Queue Processing Toggle Functions
    function initializeQueueProcessingToggle() {
        const toggle = document.getElementById('queue-processing-toggle');
        const statusIndicator = document.getElementById('queue-processing-status');
        
        if (!toggle || !statusIndicator) {
            console.warn('Queue processing toggle elements not found');
            return;
        }

        // Load current settings
        loadQueueProcessingStatus();

        // Add event listener for toggle changes
        toggle.addEventListener('change', async (e) => {
            const enabled = e.target.checked;
            
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
                    updateToggleStatus(enabled);
                    console.log(`Queue processing ${enabled ? 'enabled' : 'disabled'}`);
                } else {
                    throw new Error(result.error || 'Failed to update setting');
                }
            } catch (error) {
                console.error('Error toggling queue processing:', error);
                alert('Failed to update queue processing setting');
                // Revert toggle state
                e.target.checked = !enabled;
            }
        });
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
                
                const toggle = document.getElementById('queue-processing-toggle');
                if (toggle) {
                    toggle.checked = enabled;
                    updateToggleStatus(enabled);
                }
            }
        } catch (error) {
            console.error('Error loading queue processing status:', error);
            // Default to enabled if we can't load the setting
            updateToggleStatus(true);
        }
    }

    function updateToggleStatus(enabled) {
        const statusIndicator = document.getElementById('queue-processing-status');
        
        if (statusIndicator) {
            statusIndicator.textContent = enabled ? 'Enabled' : 'Disabled';
            statusIndicator.className = `status-indicator ${enabled ? 'enabled' : 'disabled'}`;
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
});
