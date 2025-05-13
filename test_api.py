import requests
import json

# --- Configuration ---
# Replace with the actual IP address and port of your Forge instance
FORGE_API_URL = "http://192.168.73.138:42003"
# Endpoint to test (e.g., list available SD models)
TEST_ENDPOINT = "/sdapi/v1/sd-models"

# Construct the full URL
url = f"{FORGE_API_URL}{TEST_ENDPOINT}"

print(f"Attempting to connect to: {url}")

try:
    # Send a GET request to the endpoint
    # Set a timeout (e.g., 10 seconds) to avoid waiting indefinitely
    response = requests.get(url, timeout=10)

    # Check if the request was successful (status code 200 OK)
    response.raise_for_status() # Raises an HTTPError for bad responses (4xx or 5xx)

    print("\n--- Connection Successful! ---")

    # Try to parse the JSON response
    try:
        models = response.json()
        print(f"\nSuccessfully retrieved {len(models)} models:")
        # Print model titles nicely
        for i, model in enumerate(models):
            print(f"  {i+1}. {model.get('title', 'N/A')} ({model.get('model_name', 'N/A')})")
    except json.JSONDecodeError:
        print("\nResponse received, but it wasn't valid JSON.")
        print("Response Text:")
        print(response.text)

except requests.exceptions.ConnectionError as e:
    print("\n--- Connection Failed ---")
    print(f"Error: Could not connect to the server at {FORGE_API_URL}.")
    print("Troubleshooting tips:")
    print(f"  1. Verify Forge is running on 192.168.73.138.")
    print(f"  2. Double-check the port number (is 420003 correct?). Standard webui often uses 7860.")
    print(f"  3. Ensure the machine running this script is on the same network (192.168.73.x).")
    print(f"  4. Check if a firewall on the server (192.168.73.138) or this machine is blocking the connection.")
    print(f"  5. Make sure Forge was started with the '--api' command-line argument (or API enabled in settings).")
    print(f"\nDetails: {e}")

except requests.exceptions.Timeout:
    print("\n--- Connection Timed Out ---")
    print(f"Error: The request to {url} timed out.")
    print("The server might be running but too slow to respond, or network issues might exist.")

except requests.exceptions.HTTPError as e:
    print("\n--- HTTP Error ---")
    print(f"Error: The server returned an error status code: {e.response.status_code}")
    print(f"URL: {url}")
    print("Response Body:")
    print(e.response.text)
    print("\nThis might mean the endpoint exists but there was an issue, or the endpoint requires authentication/specific parameters.")

except requests.exceptions.RequestException as e:
    print("\n--- An Unexpected Error Occurred ---")
    print(f"Error: {e}")


