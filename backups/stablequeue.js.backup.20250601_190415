(function() {
    'use strict';
    
    const EXTENSION_NAME = 'StableQueue';
    
    console.log(`[${EXTENSION_NAME}] ===== EXTENSION SCRIPT LOADING =====`);
    console.log(`[${EXTENSION_NAME}] Script loaded at:`, new Date().toISOString());
    console.log(`[${EXTENSION_NAME}] Document ready state:`, document.readyState);

    function addButtonToTab(tabId) {
        const generateBtn = document.querySelector(`#${tabId}_generate`);
        if (!generateBtn) {
            console.log(`[${EXTENSION_NAME}] Generate button not found for ${tabId}`);
            return;
        }
        
        // Create Queue button
        const queueBtn = document.createElement('button');
        queueBtn.id = `${tabId}_queue_stablequeue`;
        queueBtn.className = generateBtn.className;
        queueBtn.innerHTML = 'Queue in StableQueue';
        queueBtn.style.backgroundColor = '#3498db';
        queueBtn.style.marginLeft = '5px';
        
        // Create Bulk Queue button
        const bulkQueueBtn = document.createElement('button');
        bulkQueueBtn.id = `${tabId}_bulk_queue_stablequeue`;
        bulkQueueBtn.className = generateBtn.className;
        bulkQueueBtn.innerHTML = 'Bulk Queue';
        bulkQueueBtn.style.backgroundColor = '#2980b9';
        bulkQueueBtn.style.marginLeft = '5px';
        
        // Insert buttons after Generate
        generateBtn.parentNode.insertBefore(queueBtn, generateBtn.nextSibling);
        generateBtn.parentNode.insertBefore(bulkQueueBtn, queueBtn.nextSibling);
        
        // Add click event listeners
        queueBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (queueBtn.disabled) return;
            queueBtn.disabled = true;
            console.log(`[${EXTENSION_NAME}] Queue button clicked for ${tabId}`);
            await queueCurrentJob(tabId, 'single')
                .finally(() => (queueBtn.disabled = false));
        });
        
        bulkQueueBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            if (bulkQueueBtn.disabled) return;
            bulkQueueBtn.disabled = true;
            console.log(`[${EXTENSION_NAME}] Bulk queue button clicked for ${tabId}`);
            
            await queueCurrentJob(tabId, 'bulk')
                .finally(() => (bulkQueueBtn.disabled = false));
        });
    }

    // Register context menu handlers
    function registerContextMenuHandlers() {
        if (typeof gradioApp === 'undefined') {
            console.log(`[${EXTENSION_NAME}] gradioApp not defined, waiting...`);
            setTimeout(registerContextMenuHandlers, 1000);
            return;
        }
        
        // Single job context menu handler
        window.stablequeue_send_single = function(params) {
            const data = JSON.parse(JSON.stringify(params));
            
            // Get the selected server using our helper function with improved error handling
            const serverAlias = getSelectedServer();
            
            if (!serverAlias) {
                params.notification = { text: `No server selected in StableQueue tab. Please select a server first.`, type: 'error' };
                return params;
            }
            
            // Send job to StableQueue via the API using the complete context menu data
            fetch('/stablequeue/queue_job', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    api_payload: data,  // Use complete context menu data as API payload
                    server_alias: serverAlias,
                    job_type: 'single'
                })
            })
            .then(async (response) => {
                if (!response.ok) {
                    const text = await response.text();
                    throw new Error(`HTTP ${response.status}: ${text.slice(0,120)}`);
                }
                return response.json();
            })
            .then((data) => {
                if (data.success) {
                    params.notification = { text: data.message, type: 'success' };
                } else {
                    params.notification = { text: `Error: ${data.message || 'Unknown error'}`, type: 'error' };
                }
            })
            .catch(error => {
                console.error(`[${EXTENSION_NAME}] Error sending job:`, error);
                params.notification = { text: `Connection error: ${error.message}`, type: 'error' };
            });
            
            return params;
        };
        
        // Bulk job context menu handler
        window.stablequeue_send_bulk = function(params) {
            const data = JSON.parse(JSON.stringify(params));
            
            // Get the selected server using our helper function with improved error handling
            const serverAlias = getSelectedServer();
            
            if (!serverAlias) {
                params.notification = { text: `No server selected in StableQueue tab. Please select a server first.`, type: 'error' };
                return params;
            }
            
            // Send bulk job to StableQueue via Forge backend using complete context menu data
            fetch('/stablequeue/queue_job', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    api_payload: data,  // Use complete context menu data as API payload
                    server_alias: serverAlias,
                    job_type: 'bulk'
                })
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    params.notification = { text: data.message, type: 'success' };
                } else {
                    params.notification = { text: `Error: ${data.message || 'Unknown error'}`, type: 'error' };
                }
            })
            .catch(error => {
                console.error(`[${EXTENSION_NAME}] Error sending bulk job:`, error);
                params.notification = { text: `Connection error: ${error.message}`, type: 'error' };
            });
            
            return params;
        };
        
        console.log(`[${EXTENSION_NAME}] Context menu handlers registered`);
    }

    // Function to show notifications in the UI
    function showNotification(message, type) {
        // Try to find an existing notification area or create one
        let notificationArea = document.querySelector('#stablequeue-notifications');
        if (!notificationArea) {
            notificationArea = document.createElement('div');
            notificationArea.id = 'stablequeue-notifications';
            notificationArea.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 10000;
                max-width: 400px;
            `;
            document.body.appendChild(notificationArea);
        }
        
        // Create notification element
        const notification = document.createElement('div');
        notification.style.cssText = `
            padding: 12px 16px;
            margin-bottom: 8px;
            border-radius: 4px;
            color: white;
            font-weight: 500;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            background-color: ${type === 'success' ? '#28a745' : '#dc3545'};
        `;
        notification.textContent = message;
        
        notificationArea.appendChild(notification);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 5000);
    }

    // Helper functions to get configuration from localStorage or defaults
    function getStableQueueUrl() {
        return localStorage.getItem('stablequeue_url') || 'http://192.168.73.124:8083';
    }

    function getApiKey() {
        return localStorage.getItem('stablequeue_api_key') || '';
    }

    function getApiSecret() {
        return localStorage.getItem('stablequeue_api_secret') || '';
    }

    // Function to get selected server from StableQueue tab with enhanced Gradio support
    function getSelectedServer() {
        const serverDropdown = document.querySelector('#stablequeue_server_dropdown');
        
        if (!serverDropdown) {
            console.error(`[${EXTENSION_NAME}] Server dropdown (#stablequeue_server_dropdown) not found.`);
            return null;
        }

        // --- DETAILED LOGGING FOR DROPDOWN STATE ---
        console.log(`[${EXTENSION_NAME}] --- Debugging Dropdown State ---`);
        console.log(`[${EXTENSION_NAME}] Dropdown Element:`, serverDropdown);
        console.log(`[${EXTENSION_NAME}] Element tagName: ${serverDropdown.tagName}`);
        console.log(`[${EXTENSION_NAME}] Element className: ${serverDropdown.className}`);
        console.log(`[${EXTENSION_NAME}] Element type: ${serverDropdown.type || 'undefined'}`);
        
        // Try to get the value using multiple approaches
        let serverAlias = null;
        
        // Check if it's a standard select element
        if (serverDropdown.tagName === 'SELECT') {
            console.log(`[${EXTENSION_NAME}] Standard SELECT element found`);
            serverAlias = serverDropdown.value;
            console.log(`[${EXTENSION_NAME}] Dropdown Value: "${serverAlias}"`);
            console.log(`[${EXTENSION_NAME}] Selected Index: ${serverDropdown.selectedIndex}`);
            
            if (serverDropdown.options && serverDropdown.options.length > 0) {
                console.log(`[${EXTENSION_NAME}] Options count: ${serverDropdown.options.length}`);
                if (serverDropdown.selectedIndex >= 0) {
                    const selectedOpt = serverDropdown.options[serverDropdown.selectedIndex];
                    console.log(`[${EXTENSION_NAME}] Selected Option: "${selectedOpt.text}" (value: "${selectedOpt.value}")`);
                }
            }
        } else {
            console.log(`[${EXTENSION_NAME}] Non-standard element found (likely Gradio component)`);
            console.log(`[${EXTENSION_NAME}] Element innerHTML:`, serverDropdown.innerHTML.substring(0, 200) + '...');
            
            // Try to find nested select element within the Gradio component
            const nestedSelect = serverDropdown.querySelector('select');
            if (nestedSelect) {
                console.log(`[${EXTENSION_NAME}] Found nested SELECT element`);
                serverAlias = nestedSelect.value;
                console.log(`[${EXTENSION_NAME}] Nested select value: "${serverAlias}"`);
                console.log(`[${EXTENSION_NAME}] Nested select options count: ${nestedSelect.options ? nestedSelect.options.length : 'undefined'}`);
            } else {
                console.log(`[${EXTENSION_NAME}] No nested SELECT element found`);
                
                // Try to find input element (some Gradio dropdowns use input)
                const gradioInput = serverDropdown.querySelector('input');
                if (gradioInput) {
                    serverAlias = gradioInput.value;
                    console.log(`[${EXTENSION_NAME}] Found input element with value: "${serverAlias}"`);
                }
                
                const gradioOptions = serverDropdown.querySelectorAll('[role="option"]');
                if (gradioOptions.length > 0) {
                    console.log(`[${EXTENSION_NAME}] Found ${gradioOptions.length} role="option" elements`);
                }
            }
        }
        console.log(`[${EXTENSION_NAME}] --- End Debugging Dropdown State ---`);

        console.log(`[${EXTENSION_NAME}] Final serverAlias extracted: "${serverAlias}"`);

        // Validate the extracted server alias
        if (!serverAlias || serverAlias.trim() === "") {
            console.error(`[${EXTENSION_NAME}] Error: No server selected or dropdown value is empty. Final serverAlias: "${serverAlias}"`);
            return null;
        }
        
        // Check for the default "Configure" text
        if (serverAlias === "Configure API key in settings") {
            console.error(`[${EXTENSION_NAME}] Error: "Configure API key in settings" was the effective value.`);
            return null;
        }
        
        return serverAlias;
    }

    // Function to monitor and save server selection
    function monitorServerSelection() {
        // Try to find the server dropdown and add change listener
        const selectors = [
            '#stablequeue select',
            '[id*="stablequeue"] select',
            'div[id*="stablequeue"] select'
        ];
        
        for (const selector of selectors) {
            try {
                const dropdown = document.querySelector(selector);
                if (dropdown && !dropdown.hasAttribute('data-stablequeue-monitored')) {
                    dropdown.setAttribute('data-stablequeue-monitored', 'true');
                    dropdown.addEventListener('change', function() {
                        if (this.value && this.value !== "Configure API key in settings") {
                            localStorage.setItem('stablequeue_selected_server', this.value);
                            console.log(`[${EXTENSION_NAME}] Saved selected server to localStorage: ${this.value}`);
                        }
                    });
                    console.log(`[${EXTENSION_NAME}] Added change listener to server dropdown`);
                    break;
                }
            } catch (e) {
                // Continue to next selector
            }
        }
        
        // Re-run this function periodically to catch dynamically created dropdowns
        setTimeout(monitorServerSelection, 2000);
    }

    // Main function to queue current job
    function queueCurrentJob(tabId, jobType) {
        return new Promise(async (resolve, reject) => {
            try {
                console.log(`[${EXTENSION_NAME}] Starting queueCurrentJob for ${tabId}, jobType: ${jobType}`);
                
                // Get the selected server with error handling
                const serverAlias = getSelectedServer();
                
                if (!serverAlias) {
                    const message = 'No server selected in StableQueue tab. Please select a server first.';
                    showNotification(message, 'error');
                    reject(new Error(message));
                    return;
                }
                
                console.log(`[${EXTENSION_NAME}] Using server: ${serverAlias}`);
                
                // Store original fetch and XHR
                const originalFetch = window.fetch;
                const originalXHR = window.XMLHttpRequest;
                
                let intercepted = false;
                
                // Enhanced fetch interception
                window.fetch = async function(url, options) {
                    console.log(`[${EXTENSION_NAME}] 🌐 INTERCEPTED FETCH: ${options?.method || 'GET'} ${url}`);
                    
                    // Intercept both /sdapi/v1/ and Gradio endpoints
                    if ((url.includes('/sdapi/v1/txt2img') || 
                         url.includes('/sdapi/v1/img2img') ||
                         url.includes('/api/') || 
                         url.includes('/run/') || 
                         url.includes('/predict')) && 
                        options?.method === 'POST' && !intercepted) {
                        
                        intercepted = true;
                        console.log(`[${EXTENSION_NAME}] 🎯 API CALL INTERCEPTED: ${url}`);
                        
                        try {
                            let apiPayload;
                            
                            if (url.includes('/sdapi/v1/')) {
                                // Direct /sdapi/v1/ call - use as-is
                                apiPayload = JSON.parse(options.body);
                                console.log(`[${EXTENSION_NAME}] Using /sdapi/v1/ payload directly`);
                            } else {
                                // Gradio call - convert to /sdapi/v1/ format
                                const gradioPayload = JSON.parse(options.body);
                                apiPayload = await convertGradioToSDAPI(gradioPayload, tabId);
                                console.log(`[${EXTENSION_NAME}] Converted Gradio payload to /sdapi/v1/ format`);
                            }
                            
                            const requestData = {
                                api_payload: apiPayload,
                                server_alias: serverAlias,
                                job_type: jobType
                            };
                            
                            // Restore fetch before making our call
                            window.fetch = originalFetch;
                            window.XMLHttpRequest = originalXHR;
                            
                            const response = await originalFetch('/stablequeue/queue_job', {
                                method: 'POST',
                                headers: { 
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify(requestData)
                            });
                            
                            if (!response.ok) {
                                const text = await response.text();
                                throw new Error(`HTTP ${response.status}: ${text.slice(0,120)}`);
                            }
                            
                            const data = await response.json();
                            
                            if (data.success) {
                                showNotification(data.message, 'success');
                                resolve(data);
                            } else {
                                const errorMsg = `Error: ${data.message || 'Unknown error'}`;
                                showNotification(errorMsg, 'error');
                                reject(new Error(errorMsg));
                            }
                            
                            // Return a mock response to prevent Forge from continuing
                            return new Response(JSON.stringify({ success: false, message: 'Intercepted by StableQueue' }), {
                                status: 200,
                                headers: { 'Content-Type': 'application/json' }
                            });
                            
                        } catch (error) {
                            window.fetch = originalFetch;
                            window.XMLHttpRequest = originalXHR;
                            console.error(`[${EXTENSION_NAME}] Error processing intercepted request:`, error);
                            const errorMsg = `Error: ${error.message}`;
                            showNotification(errorMsg, 'error');
                            reject(error);
                            
                            return new Response(JSON.stringify({ success: false, message: error.message }), {
                                status: 500,
                                headers: { 'Content-Type': 'application/json' }
                            });
                        }
                    }
                    
                    // Not a target URL, pass through normally
                    return originalFetch.apply(this, arguments);
                };
                
                // Enhanced XHR interception
                window.XMLHttpRequest = function() {
                    const xhr = new originalXHR();
                    const originalOpen = xhr.open;
                    const originalSend = xhr.send;
                    let requestUrl = '';
                    
                    xhr.open = function(method, url, ...args) {
                        requestUrl = url;
                        console.log(`[${EXTENSION_NAME}] 🌐 INTERCEPTED XHR: ${method} ${url}`);
                        return originalOpen.apply(this, arguments);
                    };
                    
                    xhr.send = function(data) {
                        if ((requestUrl.includes('/sdapi/v1/txt2img') || 
                             requestUrl.includes('/sdapi/v1/img2img') ||
                             requestUrl.includes('/api/') || 
                             requestUrl.includes('/run/') || 
                             requestUrl.includes('/predict')) && 
                            data && !intercepted) {
                            
                            intercepted = true;
                            console.log(`[${EXTENSION_NAME}] 🎯 XHR API CALL INTERCEPTED: ${requestUrl}`);
                            
                            // Handle XHR interception similar to fetch
                            setTimeout(async () => {
                                try {
                                    let apiPayload;
                                    
                                    if (requestUrl.includes('/sdapi/v1/')) {
                                        apiPayload = JSON.parse(data);
                                    } else {
                                        const gradioPayload = JSON.parse(data);
                                        apiPayload = await convertGradioToSDAPI(gradioPayload, tabId);
                                    }
                                    
                                    const requestData = {
                                        api_payload: apiPayload,
                                        server_alias: serverAlias,
                                        job_type: jobType
                                    };
                                    
                                    window.fetch = originalFetch;
                                    window.XMLHttpRequest = originalXHR;
                                    
                                    const response = await originalFetch('/stablequeue/queue_job', {
                                        method: 'POST',
                                        headers: { 
                                            'Content-Type': 'application/json'
                                        },
                                        body: JSON.stringify(requestData)
                                    });
                                    
                                    if (!response.ok) {
                                        const text = await response.text();
                                        throw new Error(`HTTP ${response.status}: ${text.slice(0,120)}`);
                                    }
                                    
                                    const data = await response.json();
                                    
                                    if (data.success) {
                                        showNotification(data.message, 'success');
                                        resolve(data);
                                    } else {
                                        const errorMsg = `Error: ${data.message || 'Unknown error'}`;
                                        showNotification(errorMsg, 'error');
                                        reject(new Error(errorMsg));
                                    }
                                    
                                } catch (error) {
                                    window.fetch = originalFetch;
                                    window.XMLHttpRequest = originalXHR;
                                    console.error(`[${EXTENSION_NAME}] Error processing intercepted XHR:`, error);
                                    const errorMsg = `Error: ${error.message}`;
                                    showNotification(errorMsg, 'error');
                                    reject(error);
                                }
                            }, 0);
                            
                            // Mock successful response to prevent Forge from processing
                            setTimeout(() => {
                                Object.defineProperty(xhr, 'status', { value: 200 });
                                Object.defineProperty(xhr, 'responseText', { value: '{"success": false, "message": "Intercepted by StableQueue"}' });
                                if (xhr.onreadystatechange) {
                                    Object.defineProperty(xhr, 'readyState', { value: 4 });
                                    xhr.onreadystatechange();
                                }
                            }, 10);
                            
                            return;
                        }
                        
                        return originalSend.apply(this, arguments);
                    };
                    
                    return xhr;
                };
                
                // Try to find and click the generate button to trigger the API call
                const generateBtn = document.querySelector(`#${tabId}_generate`);
                if (generateBtn) {
                    console.log(`[${EXTENSION_NAME}] Clicking generate button to trigger API call`);
                    generateBtn.click();
                } else {
                    // Restore fetch and XHR, then error
                    window.fetch = originalFetch;
                    window.XMLHttpRequest = originalXHR;
                    showNotification('Generate button not found', 'error');
                    reject(new Error('Generate button not found'));
                }
                
                // Timeout with fallback to UI extraction
                setTimeout(async () => {
                    if (!intercepted) {
                        window.fetch = originalFetch;
                        window.XMLHttpRequest = originalXHR;
                        console.log(`[${EXTENSION_NAME}] Timeout: No API call intercepted, using UI extraction fallback`);
                        
                        try {
                            // Fallback: extract parameters directly from UI
                            const apiPayload = await extractParametersFromUI(tabId);
                            const requestData = {
                                api_payload: apiPayload,
                                server_alias: serverAlias,
                                job_type: jobType
                            };
                            
                            const response = await originalFetch('/stablequeue/queue_job', {
                                method: 'POST',
                                headers: { 
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify(requestData)
                            });
                            
                            if (!response.ok) {
                                const text = await response.text();
                                throw new Error(`HTTP ${response.status}: ${text.slice(0,120)}`);
                            }
                            
                            const data = await response.json();
                            
                            if (data.success) {
                                showNotification(`${data.message} (using UI extraction)`, 'success');
                                resolve(data);
                            } else {
                                const errorMsg = `Error: ${data.message || 'Unknown error'}`;
                                showNotification(errorMsg, 'error');
                                reject(new Error(errorMsg));
                            }
                        } catch (error) {
                            console.error(`[${EXTENSION_NAME}] Error with UI extraction fallback:`, error);
                            const errorMsg = `Connection error: ${error.message}`;
                            showNotification(errorMsg, 'error');
                            reject(error);
                        }
                    }
                }, 5000);
                
            } catch (error) {
                console.error(`[${EXTENSION_NAME}] Error in queueCurrentJob:`, error);
                showNotification(`Error: ${error.message}`, 'error');
                reject(error);
            }
        });
    }
    
    // Helper function to convert Gradio API payload to /sdapi/v1/ format
    async function convertGradioToSDAPI(gradioPayload, tabId) {
        console.log(`[${EXTENSION_NAME}] Converting Gradio payload:`, gradioPayload);
        
        // For now, fall back to UI extraction since Gradio payloads are complex
        // In the future, we could add specific conversion logic here
        return await extractParametersFromUI(tabId);
    }
    
    // Fallback function to extract parameters from UI elements
    async function extractParametersFromUI(tabId) {
        console.log(`[${EXTENSION_NAME}] Extracting parameters from UI for ${tabId}`);
        
        try {
            // Basic parameters that we can extract from UI
            const prompt = document.querySelector(`#${tabId}_prompt textarea`)?.value || '';
            const negativePrompt = document.querySelector(`#${tabId}_neg_prompt textarea`)?.value || '';
            
            // Try to get steps, cfg, width, height with multiple selector strategies
            const steps = parseInt(
                document.querySelector(`#${tabId}_steps input`)?.value ||
                document.querySelector(`[data-testid="${tabId}_steps"] input`)?.value ||
                '20'
            );
            const cfgScale = parseFloat(
                document.querySelector(`#${tabId}_cfg_scale input`)?.value ||
                document.querySelector(`[data-testid="${tabId}_cfg_scale"] input`)?.value ||
                '7.0'
            );
            const width = parseInt(
                document.querySelector(`#${tabId}_width input`)?.value ||
                document.querySelector(`[data-testid="${tabId}_width"] input`)?.value ||
                '512'
            );
            const height = parseInt(
                document.querySelector(`#${tabId}_height input`)?.value ||
                document.querySelector(`[data-testid="${tabId}_height"] input`)?.value ||
                '512'
            );
            
            // Try to get sampler
            const samplerDropdown = document.querySelector(`#${tabId}_sampling select`) ||
                                  document.querySelector(`[data-testid="${tabId}_sampling"] select`);
            const samplerName = samplerDropdown?.value || 'Euler a';
            
            // Basic payload structure for /sdapi/v1/txt2img
            const apiPayload = {
                prompt: prompt,
                negative_prompt: negativePrompt,
                steps: steps,
                cfg_scale: cfgScale,
                width: width,
                height: height,
                sampler_name: samplerName,
                batch_size: 1,
                n_iter: 1,
                seed: -1,
                subseed: -1,
                subseed_strength: 0,
                restore_faces: false,
                tiling: false,
                send_images: true,
                save_images: true
            };
            
            console.log(`[${EXTENSION_NAME}] Extracted basic UI parameters:`, apiPayload);
            
            // TODO: Add extraction for extension parameters
            // This is where we'd need to add logic to capture ControlNet, regional prompting, etc.
            
            return apiPayload;
            
        } catch (error) {
            console.error(`[${EXTENSION_NAME}] Error extracting parameters from UI:`, error);
            throw error;
        }
    }
    
    // Add "Queue in StableQueue" button next to the Generate button
    function addQueueButtons() {
        console.log(`[${EXTENSION_NAME}] addQueueButtons() called`);
        
        // Install comprehensive HTTP logging first to debug API calls
        installHttpLogging();
        
        // Try multiple strategies to add buttons
        const strategies = [1000, 2000, 3000, 5000];
        let strategyIndex = 0;
        
        function tryAddButtons() {
            console.log(`[${EXTENSION_NAME}] Attempting to add buttons (attempt ${strategyIndex + 1})`);
            
            // Check if generate buttons exist
            const txt2imgBtn = document.querySelector('#txt2img_generate');
            const img2imgBtn = document.querySelector('#img2img_generate');
            
            console.log(`[${EXTENSION_NAME}] txt2img generate button found:`, !!txt2imgBtn);
            console.log(`[${EXTENSION_NAME}] img2img generate button found:`, !!img2imgBtn);
            
            if (txt2imgBtn) {
                console.log(`[${EXTENSION_NAME}] txt2img button element:`, txt2imgBtn);
                addButtonToTab('txt2img');
            }
            
            if (img2imgBtn) {
                console.log(`[${EXTENSION_NAME}] img2img button element:`, img2imgBtn);
                addButtonToTab('img2img');
            }
            
            // Check if we successfully added buttons
            const queueBtn1 = document.querySelector('#txt2img_queue_stablequeue');
            const queueBtn2 = document.querySelector('#img2img_queue_stablequeue');
            
            console.log(`[${EXTENSION_NAME}] Queue buttons created - txt2img:`, !!queueBtn1, 'img2img:', !!queueBtn2);
            
            if ((!txt2imgBtn || !img2imgBtn || !queueBtn1 || !queueBtn2) && strategyIndex < strategies.length - 1) {
                strategyIndex++;
                console.log(`[${EXTENSION_NAME}] Retrying in ${strategies[strategyIndex]}ms`);
                setTimeout(tryAddButtons, strategies[strategyIndex]);
            } else {
                console.log(`[${EXTENSION_NAME}] Button addition process completed`);
            }
        }
        
        // Start with immediate attempt
        tryAddButtons();
    }
    
    // Install comprehensive HTTP logging to debug what Forge actually does
    function installHttpLogging() {
        const originalFetch = window.fetch;
        const originalXHR = window.XMLHttpRequest;
        
        // Log all fetch calls
        window.fetch = async function(url, options) {
            console.log(`[${EXTENSION_NAME}] 🌐 FETCH: ${options?.method || 'GET'} ${url}`, {
                headers: options?.headers,
                bodyType: typeof options?.body,
                bodyPreview: typeof options?.body === 'string' ? options.body.substring(0, 200) + '...' : options?.body
            });
            return originalFetch.apply(this, arguments);
        };
        
        // Log all XHR calls  
        window.XMLHttpRequest = function() {
            const xhr = new originalXHR();
            const originalOpen = xhr.open;
            const originalSend = xhr.send;
            
            xhr.open = function(method, url, ...args) {
                console.log(`[${EXTENSION_NAME}] 🌐 XHR: ${method} ${url}`);
                return originalOpen.apply(this, arguments);
            };
            
            xhr.send = function(data) {
                if (data) {
                    console.log(`[${EXTENSION_NAME}] 🌐 XHR DATA:`, {
                        type: typeof data,
                        preview: typeof data === 'string' ? data.substring(0, 200) + '...' : data
                    });
                }
                return originalSend.apply(this, arguments);
            };
            
            return xhr;
        };
        
        console.log(`[${EXTENSION_NAME}] 🌐 HTTP logging installed - all requests will be logged`);
    }

    // Initialize when the DOM is fully loaded
    document.addEventListener('DOMContentLoaded', function() {
        console.log(`[${EXTENSION_NAME}] Extension JavaScript loaded`);
        
        // Initialize UI enhancements
        addQueueButtons();
        
        // Register context menu handlers
        registerContextMenuHandlers();
        
        // Monitor server selection
        monitorServerSelection();
    });
})(); 