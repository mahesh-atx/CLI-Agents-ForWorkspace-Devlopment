import os
import requests
import json
import sys

# Load .env manually
try:
    with open(".env", "r") as f:
        for line in f:
            if line.strip() and not line.startswith("#") and "=" in line:
                key, value = line.strip().split("=", 1)
                os.environ[key] = value
except Exception as e:
    print(f"Warning: Could not load .env: {e}")

api_key = os.environ.get("NVIDIA_API_KEY_KIMI")
if not api_key:
    print("Error: Missing NVIDIA_API_KEY_KIMI in .env")
    sys.exit(1)

invoke_url = "https://integrate.api.nvidia.com/v1/chat/completions"
stream = True

headers = {
  "Authorization": f"Bearer {api_key}",
  "Accept": "text/event-stream" if stream else "application/json"
}

payload = {
  "model": "moonshotai/kimi-k2.5",
  "messages": [{"role":"user","content":"Hello"}],
  "max_tokens": 16384,
  "temperature": 1.00,
  "top_p": 1.00,
  "stream": stream,
  "chat_template_kwargs": {"thinking":True},
}

print(f"Testing Kimi with Python requests (Key: {api_key[:10]}...)...")

try:
    response = requests.post(invoke_url, headers=headers, json=payload, stream=stream, timeout=30)
    response.raise_for_status()
    
    if stream:
        for line in response.iter_lines():
            if line:
                decoded = line.decode("utf-8")
                print(decoded)
    else:
        print(response.json())

except Exception as e:
    print(f"Error: {e}")
