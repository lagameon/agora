export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /** Anthropic prompt caching hint */
  cache_control?: { type: 'ephemeral' };
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ChatProvider {
  /** Send messages and get a complete response */
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;
  /** Send messages and stream response chunks */
  stream(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<string>;
}

export type ProviderFactory = (model: string) => ChatProvider;
