import { LlmModelConfig } from "./types";

const chatModel: LlmModelConfig = {
  provider: 'ollama',
  model: 'qwen3.5:9b',
  reasoning: {
    effort: 'low' // This is just a default and can be changed when calling the llm
  }
};

const skillModel: LlmModelConfig = {
  provider: 'openrouter',
  model: 'x-ai/grok-4.1-fast',
  reasoning: {
    effort: 'medium' // This is just a default and can be changed when calling the llm
  }
};

const cultureModel: LlmModelConfig = {
  provider: 'openrouter',
  model: 'x-ai/grok-4.1-fast',
  reasoning: {
    effort: 'medium'
  }
};

const summaryModel: LlmModelConfig = {
  provider: 'ollama',
  model: 'gemma4:e2b',
  reasoning: {
    effort: 'none'
  }
};

export const config = {
  host: 'localhost',
  port: 25565,
  agents: ['Bot1', 'Bot2'],
  auth: 'offline' as const,
  ai: {
    maxHistoryMessages: 15,
    summarizeChunkSize: 5,
    llmTimeoutRetries: 5
  },
  actions: {
    generationRetries: 3,
    persistSkillMinUseCount: 2
  },
  llm: {
    chat: chatModel,
    action: skillModel,
    culture: cultureModel,
    summary: summaryModel,
    ollama: {
      baseUrl: 'http://127.0.0.1:11434',
      // Keep Ollama models loaded after requests to avoid cold-load timeout spikes.
      keepAlive: -1
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
