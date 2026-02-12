/**
 * Central Model Registry
 * All available AI models and their configurations.
 */

const MODELS = {
  kimi: {
    id: "moonshotai/kimi-k2.5",
    name: "Moonshot Kimi-k2.5",
    description: "High Performance, Multi-modal",
    envKey: "NVIDIA_API_KEY_KIMI",
    maxTokens: 16384,
    temperature: 1.0,
    topP: 1.0,
    isMultimodal: true,
    extraParams: { chat_template_kwargs: { thinking: false } },
  },

  qwen: {
    id: "qwen/qwen3-coder-480b-a35b-instruct",
    name: "Qwen3-Coder-480b",
    description: "Specialized for Code",
    envKey: "NVIDIA_API_KEY_QWEN",
    maxTokens: 4096,
    temperature: 0.7,
    topP: 0.8,
    isMultimodal: false,
    extraParams: {},
  },

  glm: {
    id: "z-ai/glm4.7",
    name: "GLM-4.7",
    description: "Multi-modal Original",
    envKey: "NVIDIA_API_KEY_GLM",
    maxTokens: 16384,
    temperature: 1.0,
    topP: 1.0,
    isMultimodal: true,
    extraParams: { chat_template_kwargs: { enable_thinking: false } },
  },
};

/**
 * Returns the model config with the API key resolved from env.
 * @param {string} key - One of 'kimi', 'qwen', 'glm'
 */
export function getModel(key) {
  const model = MODELS[key];
  if (!model) throw new Error(`Unknown model key: ${key}`);

  const apiKey = process.env[model.envKey];
  if (!apiKey) {
    throw new Error(
      `Missing API key: Set ${model.envKey} in your .env file`
    );
  }

  return { ...model, apiKey };
}

/** Returns all model keys for listing. */
export function listModels() {
  return Object.entries(MODELS).map(([key, m]) => ({
    key,
    id: m.id,
    name: m.name,
    description: m.description,
  }));
}

export default MODELS;
