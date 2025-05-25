# **Stable Diffusion Forge: UI Mode to API Parameter Mapping for Image Generation**

## **I. Introduction**

### **A. Overview of Stable Diffusion Forge UI Modes**

Stable Diffusion WebUI Forge (referred to as Forge) is a platform built upon the original Stable Diffusion WebUI, which utilizes the Gradio library for its user interface.1 Forge aims to enhance development, optimize resource management, accelerate inference, and introduce experimental features.1 A key aspect of the Forge UI is its provision of presets or modes designed to tailor the user experience and optimize settings for different classes of Stable Diffusion models. These typically include modes for Standard Diffusion (SD) models (e.g., SD 1.5, SD 2.1), SDXL models, and the newer Flux models.4  
The selection of a UI mode (e.g., "sd," "xl," or "flux") is not merely a cosmetic change. It often triggers internal adjustments within Forge, enabling or disabling specific input fields and potentially altering backend processing paths or optimizations to suit the chosen model architecture.5 For instance, switching between presets can reveal or hide UI elements like "clip\_skip" or "gpu\_weights," and users have noted performance differences, suggesting that these UI modes prime the backend for specific model types.5 This implies that for an application interacting with Forge via its API, sending the correct set of parameters corresponding to the model type is crucial for achieving results comparable to those obtained through the UI and for leveraging model-specific optimizations. The "all" selection mentioned by the user query likely refers to a default or comprehensive UI state where a broader set of fields might be visible before a specific preset narrows them down, or it could imply a scenario where the user manually loads any model type without a preset filtering the UI.

### **B. Purpose of this Report**

This report provides a developer-focused, concise list of User Interface (UI) fields and their likely corresponding Gradio API parameters that become relevant when 'sd,' 'xl,' 'flux,' or 'all' (interpreted as a general/default UI state) is selected or implied in the Stable Diffusion Forge UI. The objective is to facilitate the development of applications that can dynamically adjust their API payloads for image generation jobs submitted to Forge, thereby reducing the need for extensive trial-and-error testing.

### **C. Methodology**

The information presented herein is synthesized from analyses of Stable Diffusion WebUI, Forge-specific documentation, community discussions, and general knowledge of Gradio-based API behaviors. Forge's API maintains a degree of similarity with the popular Automatic1111 WebUI API to ease developer transition 3, but it incorporates its own optimizations and features, particularly for newer models like Flux, which may lead to variations. While the UI offers "modes," direct API interaction typically involves specifying a checkpoint (model) name and a payload of parameters. The "mode" of operation is thus implicitly defined by the type of checkpoint used and the set of parameters sent in the API request.

## **II. General API Endpoints and Common Parameters in Forge**

### **A. Core API Endpoints**

Applications interact with Stable Diffusion Forge for image generation primarily through a set of RESTful API endpoints. These endpoints generally mirror the structure found in the Automatic1111 Stable Diffusion WebUI, upon which Forge is built.  
The most critical endpoints for image generation are:

* /sdapi/v1/txt2img: For generating images from textual prompts.7  
* /sdapi/v1/img2img: For generating images based on an initial image and a textual prompt.7

For dynamic application behavior, such as allowing users to select from available models, the following endpoint is essential:

* /sdapi/v1/sd-models: For retrieving a list of available Stable Diffusion checkpoint models loaded in Forge.7

A vital resource for developers is the API documentation typically available at the /docs endpoint of the running Forge instance (e.g., http://127.0.0.1:7860/docs). Since Gradio applications often use FastAPI underneath, this endpoint provides an interactive Swagger UI or OpenAPI specification, detailing all available endpoints, their expected request payloads, and response structures for the specific version of Forge being run.7 This should be considered the ground truth for API integration.

### **B. Common API Parameters**

A foundational set of parameters is generally applicable across most image generation tasks and model types. These parameters form the baseline for any txt2img or img2img API call. The "all" UI mode, or the default UI state before specific model-type presets are applied, would typically expose controls for these parameters.  
**Table 1: Core API Parameters for Image Generation**

| Parameter Name | Data Type | Description | Example Value | Snippet Reference(s) |
| :---- | :---- | :---- | :---- | :---- |
| prompt | string | The main positive textual prompt describing the desired image content. | "A beautiful landscape" | 8 |
| negative\_prompt | string | Textual prompt describing elements to avoid in the image. | "ugly, blurry, watermark" | 8 |
| sampler\_name | string | The sampling algorithm to use (e.g., "Euler a", "DPM++ 2M Karras"). sampler\_index can also be used. | "Euler a" | 8 |
| steps | integer | The number of denoising steps to perform. More steps can improve quality but increase generation time. | 25 | 8 |
| cfg\_scale | number | Classifier-Free Guidance scale. Higher values adhere more strictly to the prompt. | 7.0 | 8 |
| width | integer | The width of the output image in pixels. | 512 | 8 |
| height | integer | The height of the output image in pixels. | 512 | 8 |
| seed | integer | The random seed for generation. Use \-1 for a random seed. Consistent seeds reproduce images. | 12345 | 8 |
| batch\_size | integer | Number of images to generate in a single batch. | 1 | 8 |
| n\_iter | integer | Number of sequential batches to run. Total images \= batch\_size \* n\_iter. | 1 | 8 |
| restore\_faces | boolean | Whether to apply face restoration algorithms. | true | 8 |
| tiling | boolean | Whether to generate an image that can be tiled seamlessly. | false | 8 |
| override\_settings | object | A JSON object to temporarily override global settings from the UI for this generation. | {"sd\_model\_checkpoint": "model.safetensors"} | 8 |
| script\_name | string | Name of an installed script to run (e.g., "X/Y/Z plot", "ControlNet"). | "ControlNet" | 8 |
| script\_args | array | Arguments passed to the specified script. The structure depends on the script. | \[0, "controlnet\_model", 1.0,...\] | 8 |
| **For img2img primarily:** |  |  |  |  |
| init\_images | array\[string\] | Array of base64 encoded initial image(s). | \["data:image/png;base64,..."\] | 9 |
| denoising\_strength | number | Controls how much the initial image is altered (0.0 to 1.0). Higher values mean more change. | 0.75 | 8 |
| mask | string | Base64 encoded mask image for inpainting. | data:image/png;base64,... |  |
| inpainting\_fill | integer | Method for filling masked area before inpainting (0: fill, 1: original, 2: latent noise, 3: latent nothing). | 1 |  |
| inpaint\_full\_res | boolean | Whether to inpaint at full resolution or an intermediate one. | true |  |

Forge aims for API compatibility with the Automatic1111 WebUI to facilitate easier adoption by developers already familiar with that ecosystem.6 However, as Forge is an actively developed platform, particularly with the integration of new model architectures like Flux, its API may introduce new parameters or modify existing ones. Community discussions often highlight periods where API endpoints or payload structures undergo changes or fixes after major updates.7 Therefore, consulting the live /docs endpoint on the specific Forge instance is paramount for up-to-date information.  
The script\_args parameter, in conjunction with script\_name, provides a flexible mechanism for interacting with various extensions and built-in scripts, such as ControlNet.11 Instead of adding dedicated top-level API parameters for every option within every script, these complex configurations are typically passed as an array within script\_args. The alwayson\_scripts parameter, also listed in some API references 8, serves a similar purpose for scripts that are always active. Understanding the expected structure of script\_args for commonly used scripts is key to leveraging advanced functionalities programmatically.

## **III. Model-Specific UI Fields and API Parameter Mapping**

The Forge UI adapts its displayed fields based on the selected model type or preset. This section details these changes and their likely API counterparts.

### **A. Standard Diffusion (SD) Mode (e.g., SD 1.5, SD 2.1)**

**UI Context:** This mode is active when a standard Stable Diffusion model (e.g., SD 1.5, SD 2.0, SD 2.1) is selected from the checkpoint dropdown, or when the "sd" preset is explicitly chosen in the UI.4 This mode generally relies on the common parameters outlined in Section II.B.  
**Key UI Fields Enabled/Relevant for SD Mode:**

* **Stable Diffusion checkpoint**: Dropdown for selecting the primary model file (e.g., .safetensors, .ckpt).12  
* **Prompt**, **Negative Prompt**: Standard text input fields.12  
* **Sampling method**, **Sampling steps**: Standard selection and numeric input.12  
* **Width**, **Height**: Image dimensions. For SD 1.x models, typically around 512x512 pixels. For SD 2.x models, 768x768 or similar is common.12  
* **CFG Scale**, **Seed**: Standard numeric inputs.12  
* **Batch count**, **Batch size**: Standard numeric inputs.12  
* **Restore faces**, **Tiling**: Checkboxes for these features.8  
* **Hires. fix**: A checkbox to enable high-resolution fixing, which then reveals associated parameters:  
  * Upscaler: Dropdown for selecting an upscaling algorithm (e.g., "Latent", "R-ESRGAN 4x+").12  
  * Hires steps: Number of sampling steps for the high-resolution pass.12  
  * Denoising strength: Controls how much the upscaled image is altered during the second pass.12  
  * Upscale by: Factor by which to upscale the image.12  
* **Clip skip**: A slider or numeric input that controls how many final layers of the CLIP text encoder are skipped. This UI element is noted as being present in the 'sd' preset but may be absent in 'xl' or 'flux' presets.5

Corresponding API Parameters for SD Mode:  
The API parameters for SD mode are primarily those listed in Table 1\. For Hires. fix, the relevant API parameters include:

* enable\_hr: boolean (to enable the high-resolution fix).8  
* hr\_scale: number (corresponds to Upscale by).8  
* hr\_upscaler: string (name of the upscaler).8  
* denoising\_strength: number (this typically refers to the main denoising strength for img2img or the second pass of Hires. fix).8  
* hr\_second\_pass\_steps: integer (corresponds to Hires steps).8

The Clip skip setting, if not available as a direct top-level API parameter in the user's Forge version (verifiable via /docs), can usually be controlled using the override\_settings parameter, for example: override\_settings: {"clip\_skip": 2}.  
**Table 2: SD Mode \- Key UI Fields & API Parameters**

| UI Field/Concept | Likely API Parameter(s) | Notes |
| :---- | :---- | :---- |
| SD Model Checkpoint | override\_settings: {"sd\_model\_checkpoint": "model\_name.safetensors"} or selected by default if loaded. | The primary model to use. |
| Image Dimensions | width, height | Typically 512x512 or 768x768 for SD models. |
| Hires. fix | enable\_hr: true, hr\_scale, hr\_upscaler, hr\_second\_pass\_steps, (potentially denoising\_strength for HR pass) | Enables and configures the two-pass high-resolution generation process. |
| Clip skip | override\_settings: {"clip\_skip": N} (where N is an integer, e.g., 1 or 2\) | Important for style tuning with some SD 1.5 models. Check /docs for a direct parameter. |

If no model-specific advanced parameters (like those for SDXL refiners or Flux multi-encoders) are sent in an API request, the Forge backend will likely process the request assuming a standard SD model pipeline, provided the selected checkpoint is indeed an SD model. The "sd" UI preset reinforces this by presenting a more constrained set of options suitable for these foundational models.4

### **B. SDXL Mode**

**UI Context:** This mode is engaged when an SDXL (Stable Diffusion XL) model is selected as the checkpoint, or when the "xl" preset is chosen in the Forge UI.4 Forge is known for providing optimized performance for SDXL models.4  
**Key UI Fields Enabled/Relevant for SDXL Mode:**

* **Stable Diffusion checkpoint**: Selection of an SDXL Base model (e.g., sd\_xl\_base\_1.0.safetensors).11  
* **Prompt**, **Negative Prompt**: Standard text inputs. SDXL can benefit from more nuanced or longer prompts due to its improved text understanding.10  
* **Width**, **Height**: SDXL's native resolution is 1024x1024 pixels. Using dimensions close to this, or specific recommended aspect ratios (e.g., 1344x768 for 16:9, 1536x640 for 21:9), is crucial for optimal image quality and avoiding common issues like cropping or duplication.15  
* **Refiner Section**: SDXL often uses a two-stage process involving a base model and a refiner model to enhance details. This section typically appears when an SDXL base model is loaded.15  
  * Refiner Checkpoint: Dropdown to select an SDXL Refiner model (e.g., sd\_xl\_refiner\_1.0.safetensors).15  
  * Refiner Switch at: A slider or numeric input (0.0 to 1.0) determining the fraction of total sampling steps after which the process switches from the base model to the refiner model. Values around 0.6 to 0.8 are often suggested.15  
* **SD VAE Setting**: While a global setting (found in Settings \> Stable Diffusion), it's critically important for SDXL. SD VAE should be set to None or Automatic. Using VAEs from older SD 1.x models with SDXL can lead to errors or degraded quality.11  
* The gpu\_weights tab, primarily associated with Flux models, might also appear or become relevant if Forge extends similar VRAM management features to SDXL under certain conditions, though this is less commonly documented for SDXL compared to Flux.5  
* The Clip skip UI element, common in SD mode, is often absent or less relevant in the XL preset.5

**Corresponding API Parameters for SDXL Mode (extending common parameters):**

* prompt: string (used for the primary text encoder).10  
* prompt\_2: string (optional; for SDXL's second text encoder). If not provided, Forge might use the content of prompt for both encoders, potentially not fully leveraging SDXL's dual-encoder architecture for prompt interpretation.10  
* negative\_prompt: string.10  
* negative\_prompt\_2: string (optional; for the second text encoder's negative prompt).10  
* width, height: integers, adjusted to SDXL optimal sizes (e.g., 1024x1024, 1344x768).10  
* refiner\_checkpoint: string (filename of the refiner model).8  
* refiner\_switch\_at: float (e.g., 0.8; fraction of steps before switching to refiner).8  
* The denoising\_end parameter, which specifies a fraction of the total denoising process to complete, can also be used to manage the transition to a refiner, similar in concept to refiner\_switch\_at.10

**Table 3: SDXL Mode \- Key UI Fields & API Parameters**

| UI Field/Concept | Likely API Parameter(s) | Data Type | Notes/Example |
| :---- | :---- | :---- | :---- |
| SDXL Base Model | override\_settings: {"sd\_model\_checkpoint": "sd\_xl\_base\_1.0.safetensors"} or selected. | string | The primary SDXL model. |
| Second Text Prompt | prompt\_2 | string | Optional prompt for SDXL's second text encoder. |
| Second Negative Prompt | negative\_prompt\_2 | string | Optional negative prompt for SDXL's second text encoder. |
| Image Dimensions | width, height | integer | Optimal sizes are 1024x1024 or specific aspect ratios like 1344x768. |
| Refiner Model | refiner\_checkpoint | string | Name of the SDXL refiner model file. |
| Refiner Switch At | refiner\_switch\_at | float | Fraction of steps to switch to refiner (e.g., 0.8). |
| VAE Management | No specific sd\_vae parameter, or ensure override\_settings doesn't specify an incompatible VAE. | N/A | Crucial: SDXL uses its own VAE or works with Automatic. Avoid SD1.5 VAEs. |

The architecture of SDXL, notably its use of two text encoders, provides enhanced prompt understanding. API clients should ideally support prompt\_2 and negative\_prompt\_2 to fully leverage this capability.10 If these are omitted, the system might default to using the primary prompt for both encoders, which could be suboptimal for complex prompts. Similarly, careful VAE management is essential; an application should avoid sending an incompatible sd\_vae (e.g., one for SD 1.5) in the override\_settings when an SDXL model is active to prevent errors or poor image quality.11

### **C. Flux Mode**

**UI Context:** Generating images with Flux models in Forge requires a specific UI configuration. The user must select "Flux" as the "UI" type from a dropdown, typically located at the top of the Forge interface.4 This action explicitly signals Forge to optimize all relevant settings for Flux models, including sampling methods, CFG scales, and memory management strategies.  
**Key UI Fields Enabled/Relevant for Flux Mode:**

* **UI**: Dropdown selection, must be set to "Flux".16  
* **Model (Checkpoint)**: Selection of a Flux model file. These can be full safetensors models (e.g., flux1-dev-bnb-nf4-v2.safetensors) or quantized GGUF variants (e.g., flux1-dev-Q8\_0.gguf).16  
* **VAE / Text Encoder (Multiple Selection)**: This is a critical section, especially if *not* using the special Forge-optimized Flux models that bundle encoders (like flux1-dev-bnb-nf4-v2.safetensors or flux1-dev-fp8.safetensors which include a T5-FP8 text encoder).16 For original Flux models or their GGUF variants, users must manually select multiple files 16:  
  * VAE model: ae.safetensors  
  * Clip-L text encoder: clip\_l.safetensors  
  * T5 text encoder: t5xxl\_fp16.safetensors (for systems with \>=32GB RAM) or t5xxl\_fp8.safetensors (for memory-constrained systems).  
* **Diffusion in low bits**: Usually set to "Automatic." However, if using LoRAs with quantized models and encountering errors, this might need to be manually set to match the checkpoint's precision (e.g., "bnb-nf4") or to "Automatic (fp16 LoRA)".16  
* **Swap method**: Determines how data is loaded and processed. Options are typically "Queue" (slower, more stable) or "Async" (potentially faster, but riskier for crashes).16  
* **Swap location**: Specifies where model parts are offloaded. Options are "CPU" (more stable) or "Shared" (GPU shared memory, faster if supported and stable, riskier).16  
* **GPU Weights**: A slider or input to allocate a portion of VRAM specifically for the UNet weights. It is crucial *not* to maximize this value; a common recommendation is to leave approximately 4GB of VRAM free for image distillation and other processes. Incorrectly setting this is a frequent cause of performance issues or OOM errors with Flux.1  
* **CFG Scale**: For Flux models, this main CFG Scale slider in the UI should be set to **1.0**.16  
* **Distilled CFG Scale**: This separate UI element is used for actual prompt adherence with Flux models. Recommended values are 3.5 or less for photorealism, and between 3.5 and 6 for artistic styles.16  
* **Sampling method**: "Euler a" with the "Simple" scheduler is often recommended for good results with Flux.16 Other samplers can be experimented with.  
* **Sampling steps**: For Flux.1 \[dev\] models, 20-30 steps are typical. For Flux.1 \[schnell\] models, significantly fewer steps are needed, often 1-4, up to 8\.16

Corresponding API Parameters for Flux Mode:  
Due to the novelty and Forge-specific nature of many Flux UI controls, direct top-level API parameters might not exist for all of them. It is highly probable that many of these settings are controlled via the override\_settings object. The exact keys within override\_settings would need to be determined by inspecting the /docs endpoint of a Forge instance with Flux support enabled, or through experimentation.  
Hypothetical API control structure could look like this:

**Note: The following parameter names are hypothetical and need to be verified against your specific Forge instance's /docs endpoint:**

* The main cfg\_scale parameter in the API payload should be set to 1.0.  
* override\_settings might contain keys like:  
  * "flux\_ui\_mode": true (or similar to signal Flux processing)  
  * "flux\_gpu\_weights": 4096 (or the calculated value based on VRAM)  
  * "flux\_distilled\_cfg\_scale": 3.0  
  * "flux\_vae": "ae.safetensors"  
  * "flux\_text\_encoder\_1": "clip\_l.safetensors"  
  * "flux\_text\_encoder\_2": "t5xxl\_fp8.safetensors"  
  * "flux\_swap\_method": "Queue"  
  * "flux\_swap\_location": "CPU"  
  * "flux\_diffusion\_in\_low\_bits": "Automatic"

**Table 4: Flux Mode \- Key UI Fields & Potential API Parameters**

| UI Field/Concept | Potential API Control Method (Direct Param or override\_settings key) | Notes/Example |
| :---- | :---- | :---- |
| UI Mode Selection | Likely an override\_settings key, e.g., {"flux\_ui\_selected": true} or similar internal flag. This is critical. | Signals Forge to use Flux-specific logic. |
| Flux Model Checkpoint | override\_settings: {"sd\_model\_checkpoint": "flux\_model.safetensors"} or selected. | Primary Flux model. |
| VAE & Text Encoders | override\_settings: {"flux\_vae": "ae.safetensors", "flux\_text\_encoder\_clip\_l": "clip\_l.safetensors", "flux\_text\_encoder\_t5": "t5xxl\_fp8.safetensors"} (keys are hypothetical) | Essential if not using Forge-bundled Flux models. Paths might be relative to model directories. |
| Diffusion in low bits | override\_settings: {"flux\_diffusion\_in\_low\_bits": "Automatic"} (hypothetical key) | Usually "Automatic". |
| Swap Method & Location | override\_settings: {"flux\_swap\_method": "Queue", "flux\_swap\_location": "CPU"} (hypothetical keys) | "Queue" and "CPU" are safer defaults. |
| GPU Weights | override\_settings: {"flux\_gpu\_weights": X} (X \= VRAM \- \~4096MB, hypothetical key) | Critically important for performance and stability. **Do not max out.** |
| CFG Scale (Main) | cfg\_scale: 1.0 (direct API parameter) | Must be set to 1.0 for Flux models. |
| Distilled CFG Scale | override\_settings: {"flux\_distilled\_cfg\_scale": Y} (Y \= 3.0-6.0, hypothetical key) | The actual guidance strength for Flux. |

Using Flux models via the API represents a significant departure from SD or SDXL. The requirement for explicit selection of multiple auxiliary models (VAE and two different text encoders for non-bundled versions) is a key difference.16 The API client must be capable of specifying these, likely through a structured override\_settings object. The "UI: Flux" setting in the WebUI is not just a filter; it primes the backend to expect these specific configurations and resource management strategies like GPU Weights.  
The GPU Weights slider is a Forge-specific innovation to handle Flux's considerable memory footprint.16 Its translation into an API-controllable parameter (again, likely via override\_settings) is non-negotiable for achieving stable and performant remote generation with Flux models. As emphasized in community advice, setting this value too high is a common source of problems.1 Similarly, the dual CFG scale system (CFG Scale set to 1, with Distilled CFG Scale providing the actual guidance strength) is unique to Flux's implementation in Forge.16 API calls must accurately reflect this; sending a typical CFG scale value (e.g., 7.0) to the standard cfg\_scale API parameter when using a Flux model will lead to incorrect behavior.

## **IV. Understanding the 'All' UI Mode (Interpreted as Default/Flexible State)**

### **A. Likely Behavior**

The "all" selection in the Forge UI, if it functions as a distinct mode rather than just being the default state before any specific preset (sd, xl, flux) is chosen, would likely mean that the UI does not preemptively hide or disable any model-specific input fields. This mode would offer maximum flexibility, allowing a user to load any type of model (SD, SDXL, or Flux) and then manually configure all parameters that are visible and relevant for that loaded model. It represents a state of maximal UI component visibility.

### **B. API Implications**

When interacting with Forge programmatically via its API, there isn't an explicit "all" mode to select as an API parameter. The behavior of the API is dictated by the checkpoint (model) being used and the parameters sent in the payload. If an application allows a user to select any model from the list provided by the /sdapi/v1/sd-models endpoint, it becomes the application's responsibility to:

1. **Determine the model type:** This could be achieved through parsing model filenames (which often contain "sd", "xl", or "flux" identifiers), using pre-configured metadata associated with models, or allowing the user to specify the model type.  
2. **Construct the API payload appropriately:** Based on the determined model type, the application should include parameters relevant to that architecture. For example, it would include refiner\_checkpoint and refiner\_switch\_at if an SDXL model is chosen, or the suite of Flux-specific settings (multiple encoders, Distilled CFG Scale, GPU Weights configuration) if a Flux model is active.

The "all" UI concept translates to the API client needing to be comprehensive and intelligent in its parameter construction if it aims to support all model types without relying on UI-side presets to filter available options.

### **C. Recommendations for Application Logic**

To effectively manage interactions with Forge across different model types, an application should:

* **Implement model type identification:** Develop logic to discern whether a selected checkpoint is SD, SDXL, or Flux.  
* **Dynamically construct API payloads:** Based on the identified model type, the application should tailor the JSON payload sent to endpoints like /sdapi/v1/txt2img. This means conditionally adding sections or parameters. For instance, the prompt\_2, negative\_prompt\_2, refiner\_checkpoint, and refiner\_switch\_at parameters are pertinent only to SDXL. Flux models require their unique set of VAE/encoder specifications and specialized CFG/GPU weight parameters.  
* **Handle unknown model types gracefully:** If the model type cannot be determined, the application might default to sending a basic SD-compatible payload. While this might prevent errors from unrecognized parameters if an SDXL or Flux model is inadvertently used, it will not leverage the advanced features or achieve optimal results for those models.  
* **Prioritize /docs for parameter validation:** The application, or the developer building it, should regularly consult the /docs endpoint of the target Forge instance. This provides the definitive schema for accepted API parameters and their structures, which is crucial as Forge evolves.

Attempting to mimic an "all parameters enabled" UI state by naively sending *all conceivable* parameters (SD-specific, SDXL-specific, and Flux-specific) in every API call is ill-advised. This could lead to parameter conflicts (e.g., different interpretations of cfg\_scale), parameters being ignored, or unexpected behavior, depending on how robustly Forge's backend handles superfluous or irrelevant inputs for a given active model type. A more targeted, model-aware approach to API payload construction is superior.

## **V. Summary Table of Key Differentiating Parameters**

The following table provides a comparative overview of critical differentiating UI features and their corresponding API considerations across SD, SDXL, and Flux model architectures in Forge.  
**Table 5: Comparative Overview of Critical Differentiating Parameters by Model Architecture**

| Feature/Parameter Concept | SD | SDXL | Flux |
| :---- | :---- | :---- | :---- |
| **Primary Model Resolution** | Typically 512x512 or 768x768 | Native 1024x1024; specific aspect ratios recommended (e.g., 1344x768) 15 | Native 1024x1024 20 |
| **Refiner Model** | N/A (Hires.fix is different) | Yes (refiner\_checkpoint, refiner\_switch\_at) 8 | N/A |
| **Second Text Encoder** | No | Yes (prompt\_2, negative\_prompt\_2) 10 | Yes (T5 encoder, in addition to Clip-L) 16 |
| **VAE/Auxiliary Model Setup** | Single VAE, often baked in or selectable via sd\_vae override. | Specific VAE handling (SD VAE setting to None or Automatic) 11 | Requires explicit selection of VAE (ae.safetensors) AND two text encoders (clip\_l.safetensors, t5xxl\_fp16/fp8.safetensors) if not using Forge-bundled models. Controlled via override\_settings. 16 |
| **Clip Skip UI/Setting** | Yes, often relevant.5 API via override\_settings: {"clip\_skip": N}. | Less common/relevant in UI preset.5 | N/A |
| **GPU Weights UI/Setting** | No | Not typically a primary feature, though might appear.5 | Yes, critical. API via override\_settings: {"flux\_gpu\_weights": X}. **Do not max out.** 1 |
| **CFG Scale (Main API Param)** | Standard usage (e.g., 7.0) | Standard usage (e.g., 5.0-7.0) | Must be set to **1.0**.16 |
| **Distilled CFG Scale** | No | No | Yes, used for actual guidance (e.g., 3.0-6.0). API via override\_settings: {"flux\_distilled\_cfg\_scale": Y}.16 |
| **Specific UI Mode Required** | "sd" preset or default. | "xl" preset recommended. | "Flux" UI selection is mandatory in WebUI for proper operation.16 API needs to signal this. |

## **VI. Conclusion and Recommendations for API Integration**

Integrating an application with Stable Diffusion Forge's Gradio API requires careful consideration of the different model architectures (SD, SDXL, Flux) and their unique parameter requirements. The Forge UI provides presets that simplify these configurations for users, but an API client must replicate this intelligence programmatically.

### **A. Best Practices for Structuring API Calls**

* **Dynamic Payload Construction:** The most robust approach is to build API payloads dynamically based on the type of the selected checkpoint model. Avoid sending a static, one-size-fits-all payload.  
* **Model Type Identification:** Utilize the /sdapi/v1/sd-models endpoint to fetch the list of available models. Implement logic to infer model types (e.g., from filenames, or by maintaining a separate metadata store if Forge doesn't provide type information directly via API).  
* **SDXL Specifics:** When an SDXL model is used, ensure the API payload includes prompt\_2 and negative\_prompt\_2 (even if mirroring the primary prompts) for optimal text encoding. Correctly set width and height to SDXL-native or recommended aspect ratio dimensions. If using a refiner, include refiner\_checkpoint and refiner\_switch\_at. Be mindful of VAE compatibility, generally by not overriding the default VAE unless a specific, compatible SDXL VAE is intended.  
* **Flux Specifics:** For Flux models, the API call must set the main cfg\_scale parameter to 1.0. The actual guidance is controlled by a Distilled CFG Scale, and the VRAM allocation for GPU Weights must be carefully managed; both are likely configured via override\_settings. Crucially, the API payload must specify the paths to the required VAE (ae.safetensors), Clip-L text encoder (clip\_l.safetensors), and T5 text encoder (t5xxl\_fp16.safetensors or t5xxl\_fp8.safetensors), unless using a Forge-optimized Flux model that bundles these. The selection of "Flux" in the UI is a strong indicator to the backend, and API calls should similarly signal that Flux processing is intended, likely through a specific key in override\_settings.

### **B. Leveraging the /docs Endpoint**

The /docs endpoint (typically http://127.0.0.1:7860/docs) of the running Forge instance is an indispensable tool. It provides the live OpenAPI/Swagger documentation for the API, detailing exact parameter names, data types, and structures. This should be the primary reference for constructing API calls, especially as Forge evolves and new features or parameters are introduced or modified.

### **C. Handling UI-Specific Settings via override\_settings**

For many UI settings, particularly those unique to Forge or specific model types (like Clip Skip for SD, or the detailed Flux configurations such as Swap Method, Swap Location, Diffusion in low bits, GPU Weights, and Distilled CFG Scale), direct top-level API parameters may not always be available. The override\_settings field in the API payload is the standard mechanism to control these. Discovering the exact keys for override\_settings may require inspecting network requests from the Forge UI during manual operation, consulting community resources, or experimentation if they are not explicitly listed in the /docs endpoint.

### **D. Iterative Testing and Community Engagement**

While this report provides a comprehensive guide based on available information, the dynamic nature of Stable Diffusion Forge development means that targeted testing against a live Forge instance is essential.1 Developers should start with the parameters outlined here, verify against their instance's /docs, and refine based on test results. Engaging with the Stable Diffusion Forge community (e.g., GitHub discussions and issues, Reddit) can provide valuable insights into API changes, best practices for new features, and troubleshooting assistance, often before official documentation is fully updated.1  
By adopting a model-aware approach to API interaction and diligently consulting the available API documentation, developers can successfully integrate their applications with Stable Diffusion Forge and harness its diverse image generation capabilities across SD, SDXL, and Flux architectures.

#### **Works cited**

1. lllyasviel/stable-diffusion-webui-forge \- GitHub, accessed May 16, 2025, [https://github.com/lllyasviel/stable-diffusion-webui-forge](https://github.com/lllyasviel/stable-diffusion-webui-forge)  
2. Stable Diffusion Web UI Forge \- Vast.ai | Console, accessed May 16, 2025, [https://cloud.vast.ai/template/readme/94b6e3bbbc8a968fef0bae6ced1e39f2](https://cloud.vast.ai/template/readme/94b6e3bbbc8a968fef0bae6ced1e39f2)  
3. camenduru/forge \- GitHub, accessed May 16, 2025, [https://github.com/camenduru/forge](https://github.com/camenduru/forge)  
4. Installing the Forge WebUI user interface \- Andreas Kuhr, accessed May 16, 2025, [https://andreaskuhr.com/en/installing-the-forge-webui-user-interface.html](https://andreaskuhr.com/en/installing-the-forge-webui-user-interface.html)  
5. speed difference between sd/xl/flux/all presets · lllyasviel stable-diffusion-webui-forge · Discussion \#1723 \- GitHub, accessed May 16, 2025, [https://github.com/lllyasviel/stable-diffusion-webui-forge/discussions/1723](https://github.com/lllyasviel/stable-diffusion-webui-forge/discussions/1723)  
6. stable-diffusion-webui-forge: fork of https://github.com/lllyasviel/stable-diffusion-webui-forge \- Gitee, accessed May 16, 2025, [https://gitee.com/hqsrawmelon/stable-diffusion-webui-forge?skip\_mobile=true](https://gitee.com/hqsrawmelon/stable-diffusion-webui-forge?skip_mobile=true)  
7. Important API Things you Already Know... txt2img, sd-models, etc · Issue \#993 · lllyasviel/stable-diffusion-webui-forge \- GitHub, accessed May 16, 2025, [https://github.com/lllyasviel/stable-diffusion-webui-forge/issues/993](https://github.com/lllyasviel/stable-diffusion-webui-forge/issues/993)  
8. Guide to txt2img API | Automatic1111 \- Random Bits Software Engineering, accessed May 16, 2025, [https://randombits.dev/articles/stable-diffusion/txt2img](https://randombits.dev/articles/stable-diffusion/txt2img)  
9. Stable Diffusion img2img API documentation \- Segmind, accessed May 16, 2025, [https://www.segmind.com/models/sd1.5-img2img/api](https://www.segmind.com/models/sd1.5-img2img/api)  
10. Stable Diffusion XL \- Hugging Face, accessed May 16, 2025, [https://huggingface.co/docs/diffusers/api/pipelines/stable\_diffusion/stable\_diffusion\_xl](https://huggingface.co/docs/diffusers/api/pipelines/stable_diffusion/stable_diffusion_xl)  
11. How to run SD Forge WebUI on Google Colab \- Stable Diffusion Art, accessed May 16, 2025, [https://stable-diffusion-art.com/forge-colab/](https://stable-diffusion-art.com/forge-colab/)  
12. Stable Diffusion WebUI AUTOMATIC1111: A Beginner's Guide, accessed May 16, 2025, [https://stable-diffusion-art.com/automatic1111/](https://stable-diffusion-art.com/automatic1111/)  
13. AUTOMATIC1111: Complete Guide to Stable Diffusion WebUI \- Weam AI, accessed May 16, 2025, [https://weam.ai/blog/guide/stable-diffusion/automatic1111-stable-diffusion-webui-guide/](https://weam.ai/blog/guide/stable-diffusion/automatic1111-stable-diffusion-webui-guide/)  
14. stable-diffusion-webui-forge for Low VRAM machines huge VRAM and Speed Improvements : r/StableDiffusion \- Reddit, accessed May 16, 2025, [https://www.reddit.com/r/StableDiffusion/comments/1ajxus6/stablediffusionwebuiforge\_for\_low\_vram\_machines/](https://www.reddit.com/r/StableDiffusion/comments/1ajxus6/stablediffusionwebuiforge_for_low_vram_machines/)  
15. Stable Diffusion XL 1.0 model \- Stable Diffusion Art, accessed May 16, 2025, [https://stable-diffusion-art.com/sdxl-model/](https://stable-diffusion-art.com/sdxl-model/)  
16. The Flux AI guide: installation, models, prompts and settings \- Andreas Kuhr, accessed May 16, 2025, [https://andreaskuhr.com/en/flux-ai-guide.html](https://andreaskuhr.com/en/flux-ai-guide.html)  
17. \[Guide\] Getting started with Flux & Forge : r/StableDiffusion \- Reddit, accessed May 16, 2025, [https://www.reddit.com/r/StableDiffusion/comments/1feibuv/guide\_getting\_started\_with\_flux\_forge/](https://www.reddit.com/r/StableDiffusion/comments/1feibuv/guide_getting_started_with_flux_forge/)  
18. Ultimate Guide to Installing Forge UI and Flowing with Flux Models \- LunaNotes, accessed May 16, 2025, [https://lunanotes.io/summary/ultimate-guide-to-installing-forge-ui-and-flowing-with-flux-models](https://lunanotes.io/summary/ultimate-guide-to-installing-forge-ui-and-flowing-with-flux-models)  
19. How to use Flux.1 \[dev\] with WebUI Forge Also how to use GGUF and LoRA, accessed May 16, 2025, [https://www.digitalcreativeai.net/en/post/how-use-flux-1-dev-webui-forge-how-use-gguf-and-lora](https://www.digitalcreativeai.net/en/post/how-use-flux-1-dev-webui-forge-how-use-gguf-and-lora)  
20. SDXL vs Flux1.dev models comparison \- Stable Diffusion Art, accessed May 16, 2025, [https://stable-diffusion-art.com/sdxl-vs-flux/](https://stable-diffusion-art.com/sdxl-vs-flux/)  
21. reForge development has ceased (for now) : r/StableDiffusion \- Reddit, accessed May 16, 2025, [https://www.reddit.com/r/StableDiffusion/comments/1jy76i9/reforge\_development\_has\_ceased\_for\_now/](https://www.reddit.com/r/StableDiffusion/comments/1jy76i9/reforge_development_has_ceased_for_now/)