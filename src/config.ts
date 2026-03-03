export const config = {
  host: 'localhost',
  port: 25565,
  username: 'Bot',
  auth: 'offline' as const,
  ollama: {
    model: 'qwen3:4b', // Model
    baseUrl: 'http://127.0.0.1:11434'
  }
};