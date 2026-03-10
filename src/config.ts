export const config = {
  host: 'localhost',
  port: 25565,
  username: 'Bot',
  auth: 'offline' as const,
  ai: {
    maxHistoryMessages: 15,
    summarizeChunkSize: 5
  },
  ollama: {
    model: 'qwen3:4b', // Model
    baseUrl: 'http://127.0.0.1:11434'
  },
  jarName: 'server.jar',
  minRam: '4G',
  maxRam: '4G'
};
