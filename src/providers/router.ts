import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { ChatProvider, ChatMessage, ChatOptions, ProviderFactory } from './types.js';
import { withRetry } from './retry.js';

function requireKey(name: string): string {
  const key = process.env[name];
  if (!key) throw new Error(`${name} environment variable not set. Add it to .env or export it.`);
  return key;
}

// --- OpenAI Factory ---

function openaiFactory(model: string): ChatProvider {
  const client = new OpenAI({ apiKey: requireKey('OPENAI_API_KEY') });

  return {
    async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
      return withRetry(async () => {
        const res = await client.chat.completions.create({
          model,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          temperature: options?.temperature ?? 0.7,
          max_tokens: options?.maxTokens ?? 1024,
        });
        return res.choices[0]?.message?.content ?? '';
      });
    },

    async *stream(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<string> {
      const stream = await client.chat.completions.create({
        model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 1024,
        stream: true,
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) yield delta;
      }
    },
  };
}

// --- Anthropic Factory ---

function anthropicFactory(model: string): ChatProvider {
  const client = new Anthropic({ apiKey: requireKey('ANTHROPIC_API_KEY') });

  function toAnthropicMessages(messages: ChatMessage[]) {
    const system = messages.find((m) => m.role === 'system');
    const nonSystem = messages.filter((m) => m.role !== 'system');

    // Build system with cache_control if present
    const systemBlocks: Anthropic.MessageCreateParams['system'] = system
      ? [
          {
            type: 'text' as const,
            text: system.content,
            ...(system.cache_control ? { cache_control: system.cache_control } : {}),
          },
        ]
      : undefined;

    // Build messages with cache_control on content blocks where specified
    const msgs: Anthropic.MessageCreateParams['messages'] = nonSystem.map((m) => {
      if (m.cache_control) {
        return {
          role: m.role as 'user' | 'assistant',
          content: [
            {
              type: 'text' as const,
              text: m.content,
              cache_control: m.cache_control,
            },
          ],
        };
      }
      return {
        role: m.role as 'user' | 'assistant',
        content: m.content,
      };
    });

    return { system: systemBlocks, messages: msgs };
  }

  return {
    async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
      return withRetry(async () => {
        const { system, messages: msgs } = toAnthropicMessages(messages);
        const res = await client.messages.create({
          model,
          system,
          messages: msgs,
          temperature: options?.temperature ?? 0.7,
          max_tokens: options?.maxTokens ?? 1024,
        });
        const textBlock = res.content.find((b) => b.type === 'text');
        return textBlock && 'text' in textBlock ? textBlock.text : '';
      });
    },

    async *stream(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<string> {
      const { system, messages: msgs } = toAnthropicMessages(messages);
      const stream = client.messages.stream({
        model,
        system,
        messages: msgs,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 1024,
      });

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield event.delta.text;
        }
      }
    },
  };
}

// --- Google Factory ---

function googleFactory(modelName: string): ChatProvider {
  const ai = new GoogleGenerativeAI(requireKey('GOOGLE_API_KEY'));

  function toGoogleParams(messages: ChatMessage[]) {
    const system = messages.find((m) => m.role === 'system');
    const nonSystem = messages.filter((m) => m.role !== 'system');

    const contents = nonSystem.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    return { systemInstruction: system?.content, contents };
  }

  return {
    async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
      return withRetry(async () => {
        const { systemInstruction, contents } = toGoogleParams(messages);
        const genModel = ai.getGenerativeModel({
          model: modelName,
          systemInstruction: systemInstruction ?? undefined,
          generationConfig: {
            temperature: options?.temperature ?? 0.7,
            maxOutputTokens: options?.maxTokens ?? 1024,
          },
        });
        const response = await genModel.generateContent({ contents });
        return response.response.text();
      });
    },

    async *stream(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<string> {
      const { systemInstruction, contents } = toGoogleParams(messages);
      const genModel = ai.getGenerativeModel({
        model: modelName,
        systemInstruction: systemInstruction ?? undefined,
        generationConfig: {
          temperature: options?.temperature ?? 0.7,
          maxOutputTokens: options?.maxTokens ?? 1024,
        },
      });
      const response = await genModel.generateContentStream({ contents });

      for await (const chunk of response.stream) {
        const text = chunk.text();
        if (text) yield text;
      }
    },
  };
}

// --- Ollama Factory (OpenAI-compatible) ---

function ollamaFactory(model: string): ChatProvider {
  const baseURL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1';
  const client = new OpenAI({ baseURL, apiKey: 'ollama' });

  return {
    async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
      const res = await client.chat.completions.create({
        model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 1024,
      });
      return res.choices[0]?.message?.content ?? '';
    },

    async *stream(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<string> {
      const stream = await client.chat.completions.create({
        model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 1024,
        stream: true,
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) yield delta;
      }
    },
  };
}

// --- xAI/Grok Factory (OpenAI-compatible) ---

function xaiFactory(model: string): ChatProvider {
  const client = new OpenAI({
    baseURL: 'https://api.x.ai/v1',
    apiKey: requireKey('XAI_API_KEY'),
  });

  return {
    async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
      return withRetry(async () => {
        const res = await client.chat.completions.create({
          model,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          temperature: options?.temperature ?? 0.7,
          max_tokens: options?.maxTokens ?? 1024,
        });
        return res.choices[0]?.message?.content ?? '';
      });
    },

    async *stream(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<string> {
      const stream = await client.chat.completions.create({
        model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 1024,
        stream: true,
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) yield delta;
      }
    },
  };
}

// --- DeepSeek Factory (OpenAI-compatible) ---

function deepseekFactory(model: string): ChatProvider {
  const client = new OpenAI({
    baseURL: 'https://api.deepseek.com',
    apiKey: requireKey('DEEPSEEK_API_KEY'),
  });

  return {
    async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
      return withRetry(async () => {
        const res = await client.chat.completions.create({
          model,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          temperature: options?.temperature ?? 0.7,
          max_tokens: options?.maxTokens ?? 1024,
        });
        return res.choices[0]?.message?.content ?? '';
      });
    },

    async *stream(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<string> {
      const stream = await client.chat.completions.create({
        model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 1024,
        stream: true,
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) yield delta;
      }
    },
  };
}

// --- Provider Prefix Routing ---

interface PrefixRoute {
  prefix: string;
  factory: ProviderFactory;
  stripPrefix?: boolean;
}

const ROUTES: PrefixRoute[] = [
  { prefix: 'claude-', factory: anthropicFactory },
  { prefix: 'gpt-', factory: openaiFactory },
  { prefix: 'o1-', factory: openaiFactory },
  { prefix: 'o3-', factory: openaiFactory },
  { prefix: 'o4-', factory: openaiFactory },
  { prefix: 'gemini-', factory: googleFactory },
  { prefix: 'grok-', factory: xaiFactory },
  { prefix: 'deepseek-', factory: deepseekFactory },
  { prefix: 'ollama:', factory: ollamaFactory, stripPrefix: true },
];

const providerCache = new Map<string, ChatProvider>();

/** Get a ChatProvider for the given model string. Routes by model name prefix. */
export function getProvider(model: string): ChatProvider {
  const cached = providerCache.get(model);
  if (cached) return cached;

  let provider: ChatProvider | undefined;

  for (const route of ROUTES) {
    if (model.startsWith(route.prefix)) {
      const modelId = route.stripPrefix ? model.slice(route.prefix.length) : model;
      provider = route.factory(modelId);
      break;
    }
  }

  // Default to OpenAI
  if (!provider) {
    provider = openaiFactory(model);
  }

  providerCache.set(model, provider);
  return provider;
}

/** List available provider prefixes (for help text) */
export function listProviders(): string[] {
  return [
    'claude-* (Anthropic)',
    'gpt-* (OpenAI)',
    'o1-*/o3-*/o4-* (OpenAI)',
    'gemini-* (Google)',
    'grok-* (xAI)',
    'deepseek-* (DeepSeek)',
    'ollama:* (Ollama local)',
  ];
}
