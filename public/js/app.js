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

    let allServersCache = []; // Cache for server data to assist with editing
    let allLorasCache = []; // Cache for LoRA data
    let currentEventSource = null; // To keep track of the active SSE connection

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

    // Initial population of servers
    fetchAndPopulateServers();
    // Initial population of checkpoints for the generator page
    fetchAndPopulateCheckpoints();
    fetchAndCacheLoras(); // Fetch and cache LoRAs on load

    // Navigation
    const navGeneratorBtn = document.getElementById('nav-generator');
    const navServerSetupBtn = document.getElementById('nav-server-setup');
    const generatorView = document.getElementById('generator-view');
    const serverSetupView = document.getElementById('server-setup-view');

    function showView(viewToShow, buttonToActivate) {
        // Hide all views
        generatorView.style.display = 'none';
        serverSetupView.style.display = 'none';

        // Deactivate all nav buttons
        navGeneratorBtn.classList.remove('active');
        navServerSetupBtn.classList.remove('active');

        // Show the selected view and activate its button
        if (viewToShow) {
            viewToShow.style.display = 'block';
        }
        if (buttonToActivate) {
            buttonToActivate.classList.add('active');
        }
    }

    if (navGeneratorBtn && navServerSetupBtn && generatorView && serverSetupView) {
        navGeneratorBtn.addEventListener('click', () => {
            showView(generatorView, navGeneratorBtn);
        });

        navServerSetupBtn.addEventListener('click', () => {
            showView(serverSetupView, navServerSetupBtn);
            fetchAndDisplayServers(); // Fetch and display servers when switching to this view
        });

        // Initially show the generator view
        showView(generatorView, navGeneratorBtn);
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

    // TODO: Add event listeners and functions for other UI elements (Civitai, Generation Params, LoRAs, etc.)
    // TODO: Implement server setup page functionality (EDIT, DELETE handlers for buttons in the list)

    // --- GENERATOR PAGE LOGIC ---

    // Function to handle image generation button click
    async function handleGenerateImageClick(event) {
        if (event) event.preventDefault();
        if (!generateBtn) return;

        generateBtn.disabled = true;
        generateBtn.textContent = 'Generating...';
        if (outputImageContainer) outputImageContainer.innerHTML = ''; // Clear previous image
        if (progressText) progressText.textContent = 'Initiating...';
        if (progressBar) progressBar.value = 0;
        if (progressImagePreview) progressImagePreview.src = ''; progressImagePreview.style.display = 'none';

        const serverAliasValue = serverAliasSelect.value;
        if (!serverAliasValue) {
            alert('Please select a server.');
            generateBtn.disabled = false;
            generateBtn.textContent = 'Generate Image';
            return;
        }

        // Gather Lora Data (if any selected)
        const selectedLoras = [];
        const loraRows = loraRowsContainer.querySelectorAll('.lora-row');
        loraRows.forEach(row => {
            const loraSelectElement = row.querySelector('.lora-select');
            const loraWeightElement = row.querySelector('.lora-weight');
            
            if (loraSelectElement && loraWeightElement && loraSelectElement.value) {
                const selectedLoraFilename = loraSelectElement.value;
                const loraCacheEntry = allLorasCache.find(l => l.filename === selectedLoraFilename);
                const loraNameForPrompt = loraCacheEntry ? loraCacheEntry.name_for_prompt || selectedLoraFilename.replace(/\.[^/.]+$/, "") : selectedLoraFilename.replace(/\.[^/.]+$/, "");

                selectedLoras.push({
                    name: loraNameForPrompt,
                    weight: parseFloat(loraWeightElement.value) || 0.8
                });
            }
        });
        
        let finalPositivePrompt = positivePromptInput.value;
        if (selectedLoras.length > 0) {
            const loraString = selectedLoras.map(lora => `<lora:${lora.name}:${lora.weight}>`).join(' ');
            finalPositivePrompt = `${positivePromptInput.value} ${loraString}`.trim();
        }

        // --- Construct the generation_params object FIRST ---
        const genParams = {
            positive_prompt: finalPositivePrompt,
            negative_prompt: negativePromptInput.value || "",
            checkpoint_name: checkpointSelect.value, // Ensure this is selected
            style_preset: stylePresetInput?.value || "simple",
            sampling_category: samplingCategoryInput?.value || "Both",
            enable_hires_fix: enableHiresFixInput?.checked || false,
            upscaler_model: upscalerModelInput?.value || "None",
            refiner_model: refinerModelInput?.value || "None",
            num_images: parseInt(numImagesInput?.value, 10) || 1,
            seed: seedInput.value || "", // Keep as string, backend handles empty as random
            subseed: subseedInput?.value || "", // Keep as string
            width: parseInt(widthInput.value, 10) || -1,
            height: parseInt(heightInput.value, 10) || -1,
            steps: parseInt(stepsInput.value, 10) || -1,
            cfg_scale: parseFloat(cfgScaleInput.value) || 0, // Changed key to cfg_scale
            sampler_name: samplerNameInput?.value || "Euler",
            restore_faces: restoreFacesInput?.checked || false,
            scheduler_or_quality_preset: schedulerOrQualityPresetInput?.value || "Balanced",
            // Add any other params needed inside here
        };

        // --- Construct the FINAL request body ---
        const requestBody = {
            target_server_alias: serverAliasValue,
            generation_params: genParams
        };

        // Close any existing SSE connection
        if (currentEventSource) {
            currentEventSource.close();
            console.log("Previous SSE connection closed.");
        }

        try {
            console.log("Sending generation request body:", JSON.stringify(requestBody, null, 2)); // Log the correct body
            const response = await fetch('/api/v1/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody) // Send the correctly structured body
            });

            if (!response.ok) {
                // Attempt to parse error message from backend JSON response
                let errorMsg = `HTTP error! Status: ${response.status}`;
                try {
                    const errorData = await response.json();
                    errorMsg = errorData.error || errorData.message || errorMsg; 
                } catch (e) {
                    // Ignore if response is not JSON
                }
                throw new Error(errorMsg);
            }

            const result = await response.json();
            // --- THIS PART NEEDS REPLACEMENT FOR PHASE 2/3 ---
            // The backend now returns { mobilesd_job_id: "..." } on 202 Accepted
            // We need to handle this new response and start polling the status endpoint
            console.log("Received response from /generate:", result);
            if (response.status === 202 && result.mobilesd_job_id) {
                // SUCCESS! Job was queued.
                 if (progressText) progressText.textContent = `Job submitted successfully! ID: ${result.mobilesd_job_id}. Waiting for status...`;
                // TODO: Start polling GET /api/v1/queue/jobs/{result.mobilesd_job_id}/status
                // For now, just re-enable the button after successful submission
                generateBtn.disabled = false;
                generateBtn.textContent = 'Generate Image';
                alert(`Job submitted with ID: ${result.mobilesd_job_id}. Check console/queue for progress.`); // Temporary feedback
            } else {
                // Handle unexpected success response format
                throw new Error(result.message || result.error || 'Unexpected response after submitting job.');
            }
            // --- END REPLACEMENT AREA ---

        } catch (error) {
            console.error('Error submitting generation request:', error);
            alert(`Error: ${error.message}`);
            if (progressText) progressText.textContent = `Error: ${error.message}`;
            generateBtn.disabled = false;
            generateBtn.textContent = 'Generate Image';
        }
    }

    if (generateBtn) {
        generateBtn.addEventListener('click', handleGenerateImageClick);
    }

    // --- INITIALIZATION ---
});
