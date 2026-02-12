import OpenAI from "openai";

/**
 * Creates an OpenAI-compatible client pointing at the NVIDIA NIM API.
 * @param {string} apiKey - The NVIDIA API key for the chosen model.
 * @returns {OpenAI} Configured client instance.
 */
export function createClient(apiKey) {
  const baseURL = process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1";

  return new OpenAI({ apiKey, baseURL });
}
