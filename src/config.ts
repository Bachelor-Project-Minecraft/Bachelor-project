import { LlmModelConfig } from "./types";

const chatModel: LlmModelConfig = {
  provider: 'ollama',
  model: 'qwen3.5:9b',
  reasoning: {
    effort: 'high' // This is just a default and can be changed when calling the llm
  }
};

const actionModel: LlmModelConfig = {
  provider: 'openrouter',
  model: 'minimax/minimax-m2.5',
  reasoning: {
    effort: 'medium' // This is just a default and can be changed when calling the llm
  }
};

export const config = {
  host: 'localhost',
  port: 25565,
  auth: 'offline' as const,
  ai: {
    maxHistoryMessages: 15,
    summarizeChunkSize: 5
  },
  actions: {
    generationRetries: 3
  },
  llm: {
    chat: chatModel,
    action: actionModel,
    ollama: {
      baseUrl: 'http://127.0.0.1:11434'
    },
    openRouter: {
      apiKey: process.env.OPENROUTER_API_KEY ?? ''
    }
  },
  jarName: 'server.jar',
  minRam: '4G',
  maxRam: '4G',
  admins: ['MarcusVange', 'Carlzoe'],
};
