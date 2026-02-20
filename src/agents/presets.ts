import type { RoundtableConfig } from '../config/schema.js';

/** Built-in default preset: 3-agent balanced roundtable */
export const DEFAULT_PRESET: RoundtableConfig = {
  name: 'Default Roundtable',
  description: 'Balanced 3-agent panel discussion',
  maxRounds: 2,
  agents: [
    {
      id: 'analyst',
      name: 'The Analyst',
      role: 'panelist',
      model: 'gpt-4.1-mini',
      systemPrompt:
        'You are a thorough analytical thinker evaluating: {{topic}}. Examine evidence, identify key data points, and present structured arguments. Be concise and specific.',
      temperature: 0.7,
      maxTokens: 1024,
    },
    {
      id: 'critic',
      name: 'The Critic',
      role: 'panelist',
      model: 'gpt-4.1-mini',
      systemPrompt:
        "You are a devil's advocate examining: {{topic}}. Challenge assumptions, find weaknesses in arguments, and present alternative perspectives. Be concise.",
      temperature: 0.8,
      maxTokens: 1024,
    },
    {
      id: 'synthesizer',
      name: 'The Synthesizer',
      role: 'synthesizer',
      model: 'gpt-4.1-mini',
      systemPrompt:
        'Review the full discussion about: {{topic}}. Produce a clear, balanced, actionable final answer incorporating the best insights from all participants.',
      temperature: 0.3,
      maxTokens: 2048,
    },
  ],
};
