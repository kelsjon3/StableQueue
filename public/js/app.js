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

    let allServersCache = []; // Cache for server data to assist with editing
    let allLorasCache = []; // Cache for LoRA data

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
                        option.value = checkpointObj.filename;
                        let displayText = checkpointObj.filename;
                        if (checkpointObj.relativePath && checkpointObj.relativePath !== '') {
                            // Prepend subfolder if relativePath is not empty or "."
                            // path.join isn't available client-side, simple concatenation is fine here.
                            displayText = `${checkpointObj.relativePath}/${checkpointObj.filename}`;
                        }
                        option.textContent = displayText;
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
});
