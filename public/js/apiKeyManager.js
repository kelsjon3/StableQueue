/**
 * apiKeyManager.js
 * Client-side JavaScript to manage API keys in the MobileSD UI
 */

// Main class for API Key Management UI
class ApiKeyManagerUI {
    constructor() {
        // Get DOM elements
        this.apiKeysView = document.getElementById('api-keys-view');
        this.apiKeysTable = document.getElementById('api-keys-table');
        this.apiKeysRows = document.getElementById('api-keys-rows');
        this.apiKeysLoading = document.getElementById('api-keys-loading');
        this.apiKeysEmpty = document.getElementById('api-keys-empty');
        this.refreshKeysBtn = document.getElementById('refresh-keys-btn');
        this.createKeyBtn = document.getElementById('create-key-btn');
        
        // Form elements
        this.apiKeyFormContainer = document.getElementById('api-key-form-container');
        this.apiKeyForm = document.getElementById('api-key-form');
        this.apiKeyFormTitle = document.getElementById('api-key-form-title');
        this.editKeyIdInput = document.getElementById('edit-key-id');
        this.apiKeyNameInput = document.getElementById('api-key-name');
        this.apiKeyDescriptionInput = document.getElementById('api-key-description');
        this.apiKeyActiveCheckbox = document.getElementById('api-key-active');
        this.apiKeyActiveGroup = document.getElementById('api-key-active-group');
        this.saveApiKeyBtn = document.getElementById('save-api-key-btn');
        this.cancelApiKeyBtn = document.getElementById('cancel-api-key-btn');
        
        // Result elements
        this.apiKeyResultContainer = document.getElementById('api-key-result-container');
        this.newApiKeyInput = document.getElementById('new-api-key');
        this.copyApiKeyBtn = document.getElementById('copy-api-key-btn');
        this.newApiKeyId = document.getElementById('new-api-key-id');
        this.newApiKeyName = document.getElementById('new-api-key-name');
        this.newApiKeyCreated = document.getElementById('new-api-key-created');
        this.doneApiKeyBtn = document.getElementById('done-api-key-btn');
        
        // Modal elements
        this.apiKeyDetailsModal = document.getElementById('api-key-details-modal');
        this.apiKeyDetailsContent = document.getElementById('api-key-details-content');
        this.editKeyBtn = document.getElementById('edit-key-btn');
        this.deleteKeyBtn = document.getElementById('delete-key-btn');
        this.closeModalBtn = this.apiKeyDetailsModal?.querySelector('.close-modal');
        
        // Current API key for modal
        this.currentApiKey = null;
        
        // Bind event listeners
        this.bindEvents();
    }
    
    // Initialize event listeners
    bindEvents() {
        if (this.refreshKeysBtn) {
            this.refreshKeysBtn.addEventListener('click', () => this.fetchAndDisplayApiKeys());
        }
        
        if (this.createKeyBtn) {
            this.createKeyBtn.addEventListener('click', () => this.showCreateKeyForm());
        }
        
        if (this.apiKeyForm) {
            this.apiKeyForm.addEventListener('submit', (e) => this.handleFormSubmit(e));
        }
        
        if (this.cancelApiKeyBtn) {
            this.cancelApiKeyBtn.addEventListener('click', () => this.cancelKeyForm());
        }
        
        if (this.copyApiKeyBtn) {
            this.copyApiKeyBtn.addEventListener('click', () => this.copyApiKeyToClipboard());
        }
        
        if (this.doneApiKeyBtn) {
            this.doneApiKeyBtn.addEventListener('click', () => this.hideResultView());
        }
        
        if (this.closeModalBtn) {
            this.closeModalBtn.addEventListener('click', () => this.closeDetailsModal());
        }
        
        if (this.editKeyBtn) {
            this.editKeyBtn.addEventListener('click', () => this.editCurrentKey());
        }
        
        if (this.deleteKeyBtn) {
            this.deleteKeyBtn.addEventListener('click', () => this.deleteCurrentKey());
        }
    }
    
    // Fetch and display API keys
    async fetchAndDisplayApiKeys() {
        if (!this.apiKeysRows) return;
        
        // Show loading, hide empty state
        if (this.apiKeysLoading) this.apiKeysLoading.style.display = 'block';
        if (this.apiKeysEmpty) this.apiKeysEmpty.style.display = 'none';
        if (this.apiKeysTable) this.apiKeysTable.style.display = 'none';
        
        try {
            // Fetch API keys
            const response = await fetch('/api/v1/api-keys');
            
            if (!response.ok) {
                throw new Error(`Failed to fetch API keys: ${response.status} ${response.statusText}`);
            }
            
            const result = await response.json();
            const apiKeys = result.api_keys || [];
            
            // Clear existing rows
            this.apiKeysRows.innerHTML = '';
            
            if (apiKeys.length === 0) {
                // Show empty state
                if (this.apiKeysEmpty) this.apiKeysEmpty.style.display = 'block';
                if (this.apiKeysTable) this.apiKeysTable.style.display = 'none';
            } else {
                // Add rows for each API key
                apiKeys.forEach(key => {
                    this.addApiKeyRow(key);
                });
                
                // Show table, hide empty state
                if (this.apiKeysTable) this.apiKeysTable.style.display = 'table';
                if (this.apiKeysEmpty) this.apiKeysEmpty.style.display = 'none';
            }
        } catch (error) {
            console.error('Error fetching API keys:', error);
            // Show error state (could be improved with a dedicated error message element)
            this.apiKeysRows.innerHTML = `<tr><td colspan="5" class="error-message">Failed to load API keys: ${error.message}</td></tr>`;
            if (this.apiKeysTable) this.apiKeysTable.style.display = 'table';
        } finally {
            // Hide loading
            if (this.apiKeysLoading) this.apiKeysLoading.style.display = 'none';
        }
    }
    
    // Add a row for an API key to the table
    addApiKeyRow(key) {
        if (!this.apiKeysRows) return;
        
        const row = document.createElement('tr');
        row.dataset.keyId = key.id;
        
        // Format date
        const createdDate = new Date(key.created_at);
        const formattedDate = createdDate.toLocaleString();
        
        // Status badge with color
        const statusBadge = key.is_active ? 
            `<span class="status-badge status-active">Active</span>` : 
            `<span class="status-badge status-inactive">Inactive</span>`;
        
        row.innerHTML = `
            <td class="api-key-name">${key.name}</td>
            <td class="api-key-description">${key.description || '—'}</td>
            <td class="api-key-created">${formattedDate}</td>
            <td class="api-key-status">${statusBadge}</td>
            <td class="api-key-actions">
                <button class="view-key-btn small-button">Details</button>
                <button class="edit-key-btn small-button">Edit</button>
                <button class="delete-key-btn small-button danger">Delete</button>
            </td>
        `;
        
        // Add event listeners for action buttons
        const viewBtn = row.querySelector('.view-key-btn');
        const editBtn = row.querySelector('.edit-key-btn');
        const deleteBtn = row.querySelector('.delete-key-btn');
        
        if (viewBtn) {
            viewBtn.addEventListener('click', () => this.showKeyDetails(key.id));
        }
        
        if (editBtn) {
            editBtn.addEventListener('click', () => this.showEditKeyForm(key.id));
        }
        
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => this.confirmDeleteKey(key.id));
        }
        
        this.apiKeysRows.appendChild(row);
    }
    
    // Show create key form
    showCreateKeyForm() {
        // Reset form
        this.apiKeyForm.reset();
        this.editKeyIdInput.value = '';
        
        // Update UI elements for creation
        this.apiKeyFormTitle.textContent = 'Create New API Key';
        this.saveApiKeyBtn.textContent = 'Create API Key';
        
        // Hide the active checkbox for new keys (they're always active by default)
        this.apiKeyActiveGroup.style.display = 'none';
        
        // Show form, hide result view
        this.apiKeyFormContainer.style.display = 'block';
        this.apiKeyResultContainer.style.display = 'none';
    }
    
    // Show edit key form
    async showEditKeyForm(keyId) {
        try {
            // Fetch the API key details
            const response = await fetch(`/api/v1/api-keys/${keyId}`);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch API key: ${response.status} ${response.statusText}`);
            }
            
            const responseData = await response.json();
            const key = responseData.api_key || responseData;
            
            // Populate form
            this.apiKeyNameInput.value = key.name;
            this.apiKeyDescriptionInput.value = key.description || '';
            this.apiKeyActiveCheckbox.checked = key.is_active;
            this.editKeyIdInput.value = key.id;
            
            // Update UI elements for editing
            this.apiKeyFormTitle.textContent = 'Edit API Key';
            this.saveApiKeyBtn.textContent = 'Update API Key';
            
            // Show active checkbox for existing keys
            this.apiKeyActiveGroup.style.display = 'block';
            
            // Show form, hide result view
            this.apiKeyFormContainer.style.display = 'block';
            this.apiKeyResultContainer.style.display = 'none';
            
            // Close details modal if open
            this.closeDetailsModal();
        } catch (error) {
            console.error('Error fetching API key for editing:', error);
            alert(`Failed to load API key: ${error.message}`);
        }
    }
    
    // Cancel key form
    cancelKeyForm() {
        this.apiKeyFormContainer.style.display = 'none';
    }
    
    // Handle form submit (create or update key)
    async handleFormSubmit(event) {
        event.preventDefault();
        
        // Get form values
        const keyId = this.editKeyIdInput.value.trim();
        const name = this.apiKeyNameInput.value.trim();
        const description = this.apiKeyDescriptionInput.value.trim();
        const isActive = this.apiKeyActiveCheckbox.checked;
        
        // Validate name
        if (!name) {
            alert('Please enter a name for the API key');
            return;
        }
        
        // Create request data
        const keyData = {
            name,
            description
        };
        
        // Add is_active only for updates
        if (keyId) {
            keyData.is_active = isActive;
        }
        
        try {
            let response;
            let result;
            
            if (keyId) {
                // Update existing key
                response = await fetch(`/api/v1/api-keys/${keyId}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(keyData)
                });
                
                if (!response.ok) {
                    throw new Error(`Failed to update API key: ${response.status} ${response.statusText}`);
                }
                
                result = await response.json();
                
                // Hide form and refresh keys
                this.apiKeyFormContainer.style.display = 'none';
                this.fetchAndDisplayApiKeys();
                
                // Show success message
                alert(`API key "${result.name || result.api_key?.name}" updated successfully.`);
            } else {
                // Create new API key
                response = await fetch('/api/v1/api-keys', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(keyData)
                });
                
                if (!response.ok) {
                    throw new Error(`Failed to create API key: ${response.status} ${response.statusText}`);
                }
                
                result = await response.json();
                
                // Hide form and refresh keys
                this.apiKeyFormContainer.style.display = 'none';
                this.fetchAndDisplayApiKeys();
                
                // Show result view with the new key
                this.showKeyResult(result.api_key || result);
            }
        } catch (error) {
            console.error('Error submitting API key form:', error);
            alert(`Failed to ${keyId ? 'update' : 'create'} API key: ${error.message}`);
        }
    }
    
    // Show the API key result view after creation
    showKeyResult(keyData) {
        // Populate result view
        this.newApiKeyInput.value = keyData.key;
        this.newApiKeyId.textContent = keyData.id;
        this.newApiKeyName.textContent = keyData.name;
        
        // Format created date
        const createdDate = new Date(keyData.created_at);
        this.newApiKeyCreated.textContent = createdDate.toLocaleString();
        
        // Show result view
        this.apiKeyResultContainer.style.display = 'block';
    }
    
    // Copy API key to clipboard
    copyApiKeyToClipboard() {
        const keyValue = this.newApiKeyInput.value;
        if (!keyValue) return;
        
        // Use modern clipboard API
        navigator.clipboard.writeText(keyValue)
            .then(() => {
                // Change button text temporarily to show success
                const originalText = this.copyApiKeyBtn.textContent;
                this.copyApiKeyBtn.textContent = 'Copied!';
                
                // Reset button text after a delay
                setTimeout(() => {
                    this.copyApiKeyBtn.textContent = originalText;
                }, 2000);
            })
            .catch(err => {
                console.error('Failed to copy API key:', err);
                alert('Failed to copy API key to clipboard. Please select and copy it manually.');
            });
    }
    
    // Hide the result view
    hideResultView() {
        this.apiKeyResultContainer.style.display = 'none';
    }
    
    // Show API key details in modal
    async showKeyDetails(keyId) {
        try {
            // Fetch the API key details
            const response = await fetch(`/api/v1/api-keys/${keyId}`);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch API key: ${response.status} ${response.statusText}`);
            }
            
            const responseData = await response.json();
            const key = responseData.api_key || responseData;
            this.currentApiKey = key;
            
            // Format created date
            const createdDate = new Date(key.created_at);
            const formattedDate = createdDate.toLocaleString();
            
            // Last used date if available
            let lastUsedHtml = '';
            if (key.last_used_at) {
                const lastUsedDate = new Date(key.last_used_at);
                lastUsedHtml = `
                    <p><strong>Last Used:</strong> ${lastUsedDate.toLocaleString()}</p>
                `;
            }
            
            // Usage stats if available
            let usageHtml = '';
            if (key.usage_count !== undefined) {
                usageHtml = `
                    <p><strong>Usage Count:</strong> ${key.usage_count}</p>
                `;
            }
            
            // Populate modal content
            this.apiKeyDetailsContent.innerHTML = `
                <div class="key-details">
                    <p><strong>ID:</strong> ${key.id}</p>
                    <p><strong>Name:</strong> ${key.name}</p>
                    <p><strong>Description:</strong> ${key.description || '—'}</p>
                    <p><strong>Status:</strong> ${key.is_active ? 'Active' : 'Inactive'}</p>
                    <p><strong>Created:</strong> ${formattedDate}</p>
                    ${lastUsedHtml}
                    ${usageHtml}
                </div>
            `;
            
            // Show modal
            this.apiKeyDetailsModal.style.display = 'block';
        } catch (error) {
            console.error('Error fetching API key details:', error);
            alert(`Failed to load API key details: ${error.message}`);
        }
    }
    
    // Close details modal
    closeDetailsModal() {
        if (this.apiKeyDetailsModal) {
            this.apiKeyDetailsModal.style.display = 'none';
        }
        this.currentApiKey = null;
    }
    
    // Edit the current key from the modal
    editCurrentKey() {
        if (this.currentApiKey) {
            this.closeDetailsModal();
            this.showEditKeyForm(this.currentApiKey.id);
        }
    }
    
    // Confirm and delete the current key from the modal
    async deleteCurrentKey() {
        if (!this.currentApiKey) return;
        
        const confirmDelete = confirm(`Are you sure you want to delete the API key "${this.currentApiKey.name}"? This action cannot be undone.`);
        
        if (confirmDelete) {
            await this.deleteKey(this.currentApiKey.id);
            this.closeDetailsModal();
        }
    }
    
    // Confirm and delete an API key by ID
    async confirmDeleteKey(keyId) {
        try {
            // Fetch the API key details first to show the name in the confirmation
            const response = await fetch(`/api/v1/api-keys/${keyId}`);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch API key: ${response.status} ${response.statusText}`);
            }
            
            const responseData = await response.json();
            const key = responseData.api_key || responseData;
            
            const confirmDelete = confirm(`Are you sure you want to delete the API key "${key.name}"? This action cannot be undone.`);
            
            if (confirmDelete) {
                await this.deleteKey(keyId);
            }
        } catch (error) {
            console.error('Error confirming API key deletion:', error);
            
            // Fall back to a generic confirmation if we couldn't fetch the key details
            const confirmDelete = confirm(`Are you sure you want to delete this API key? This action cannot be undone.`);
            
            if (confirmDelete) {
                await this.deleteKey(keyId);
            }
        }
    }
    
    // Delete an API key by ID
    async deleteKey(keyId) {
        try {
            const response = await fetch(`/api/v1/api-keys/${keyId}`, {
                method: 'DELETE'
            });
            
            if (!response.ok) {
                throw new Error(`Failed to delete API key: ${response.status} ${response.statusText}`);
            }
            
            // Refresh the keys list
            this.fetchAndDisplayApiKeys();
            
            // Show success message
            alert('API key deleted successfully.');
        } catch (error) {
            console.error('Error deleting API key:', error);
            alert(`Failed to delete API key: ${error.message}`);
        }
    }
}

// Initialize the API Key Manager UI when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Create and store the instance for potential use by other modules
    window.apiKeyManagerUI = new ApiKeyManagerUI();
}); 