import type { RoundtableConfig } from './schema.js';

export const DEFAULT_MODEL = 'gpt-5-mini';

export const ENV_KEYS = {
  OPENAI_API_KEY: 'OPENAI_API_KEY',
  ANTHROPIC_API_KEY: 'ANTHROPIC_API_KEY',
  GOOGLE_API_KEY: 'GOOGLE_API_KEY',
  XAI_API_KEY: 'XAI_API_KEY',
  OLLAMA_BASE_URL: 'OLLAMA_BASE_URL',
} as const;

/** Minimal 2-agent config for quick testing */
export const QUICK_CONFIG: RoundtableConfig = {
  name: 'Quick Roundtable',
  maxRounds: 1,
  agents: [
    {
      id: 'analyst',
      name: 'The Analyst',
      role: 'panelist',
      model: 'gpt-5-mini',
      systemPrompt:
        'You are a thorough analytical thinker. Examine evidence, identify key data points, and present structured arguments. Be concise.',
      temperature: 0.7,
      maxTokens: 1024,
    },
    {
      id: 'synthesizer',
      name: 'The Synthesizer',
      role: 'synthesizer',
      model: 'gpt-5-mini',
      systemPrompt:
        'Review the discussion and produce a clear, balanced, actionable final answer. Be concise.',
      temperature: 0.3,
      maxTokens: 1024,
    },
  ],
};
