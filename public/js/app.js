document.addEventListener('DOMContentLoaded', () => {
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

    // Initialize the app
    initializeJobClient();
    // Start on queue view by default
    showView(queueView, navQueue);
});
