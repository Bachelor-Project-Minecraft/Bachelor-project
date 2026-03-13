export const config = {
  host: 'localhost',
  port: 25565,
  username: 'Bot',
  auth: 'offline' as const,
  ai: {
    maxHistoryMessages: 15,
    summarizeChunkSize: 5
  },
  actions: {
    generationRetries: 3
  },
  ollama: {
    model: 'qwen3.5:9b', // Model
    actionModel: 'qwen3.5:9b',
    baseUrl: 'http://127.0.0.1:11434'
  },
  jarName: 'server.jar',
  minRam: '4G',
  maxRam: '4G',
  admins: ['MarcusVange', 'Carlzoe'],
};
