#!/usr/bin/env bun

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { runRoundtable } from './roundtable/engine.js';
import { loadPreset, listPresets, interpolateConfig } from './config/loader.js';
import { DEFAULT_PRESET } from './agents/presets.js';
import { getProvider } from './providers/router.js';
import { DiscussionRecorder, listDiscussions, getDiscussion } from './history/store.js';
import { DEFAULT_MODEL } from './config/defaults.js';
import type { RoundtableConfig } from './config/schema.js';

const server = new McpServer({
  name: 'agora',
  version: '0.1.0',
});

// --- Tools ---

server.tool(
  'agora_discuss',
  'Run a multi-agent roundtable discussion. Multiple AI agents discuss a topic from different perspectives, then a synthesizer produces a final answer.',
  {
    topic: z.string().describe('The topic or question to discuss'),
    preset: z.string().optional().describe('Preset name: default, research, or debate'),
    maxRounds: z.number().optional().describe('Maximum discussion rounds (default: 2)'),
  },
  async ({ topic, preset, maxRounds }) => {
    let config: RoundtableConfig;
    let presetWarning = '';
    try {
      config = preset ? loadPreset(preset) : loadPreset('default');
    } catch (err) {
      presetWarning = `Warning: preset "${preset ?? 'default'}" not found, using built-in default.\n\n`;
      config = { ...DEFAULT_PRESET };
    }
    config = interpolateConfig(config, topic);
    if (maxRounds) config.maxRounds = maxRounds;

    const recorder = new DiscussionRecorder(topic, preset);
    const transcript: string[] = [];
    let finalAnswer = '';

    for await (const event of runRoundtable(topic, config)) {
      recorder.handleEvent(event);

      if (event.type === 'agent_done') {
        transcript.push(`**${event.agentName}** (${event.model}, Round ${event.round}):\n${event.fullResponse}`);
      }
      if (event.type === 'synthesis_done') {
        finalAnswer = event.answer;
      }
    }

    const discussionId = recorder.discussionId;

    return {
      content: [
        {
          type: 'text' as const,
          text: `${presetWarning}## Roundtable Discussion: "${topic}"\n\n### Transcript\n\n${transcript.join('\n\n---\n\n')}\n\n---\n\n### Synthesis\n\n${finalAnswer}\n\n---\n_Discussion ID: ${discussionId} | View details: agora history --id ${discussionId}_`,
        },
      ],
    };
  },
);

server.tool(
  'agora_ask',
  'Quick single-model query without roundtable discussion. Useful for simple questions.',
  {
    question: z.string().describe('The question to ask'),
    model: z.string().optional().describe(`Model to use (default: ${DEFAULT_MODEL}). Examples: gpt-4.1-mini, claude-sonnet-4-5, gemini-2.5-flash`),
  },
  async ({ question, model }) => {
    const provider = getProvider(model ?? DEFAULT_MODEL);
    const answer = await provider.chat(
      [{ role: 'user', content: question }],
      { temperature: 0.7, maxTokens: 2048 },
    );

    return {
      content: [{ type: 'text' as const, text: answer }],
    };
  },
);

// --- Resources ---

server.resource(
  'agora://presets',
  'List all available Agora discussion presets',
  async () => {
    const presets = listPresets();
    const text = presets.length === 0
      ? 'No presets available.'
      : presets.map((p) => `### ${p.name} (${p.source})\n${p.description ?? 'No description'}`).join('\n\n');

    return {
      contents: [{ uri: 'agora://presets', text, mimeType: 'text/markdown' }],
    };
  },
);

server.resource(
  'agora://history',
  'List recent Agora discussions',
  async () => {
    const discussions = listDiscussions(20);
    const text = discussions.length === 0
      ? 'No discussions yet.'
      : discussions
          .map((d) => {
            const duration = d.durationMs ? `${(d.durationMs / 1000).toFixed(0)}s` : '?';
            return `- **${d.id}**: ${d.topic} (${d.preset ?? 'default'}, ${duration}, ${d.createdAt})`;
          })
          .join('\n');

    return {
      contents: [{ uri: 'agora://history', text, mimeType: 'text/markdown' }],
    };
  },
);

server.resource(
  'discussion',
  new ResourceTemplate('agora://discussions/{id}', { list: undefined }),
  async (uri, variables) => {
    const id = typeof variables.id === 'string' ? variables.id : String(variables.id);
    const result = getDiscussion(id);

    if (!result) {
      return {
        contents: [{ uri: uri.href, text: `Discussion "${id}" not found.`, mimeType: 'text/plain' }],
      };
    }

    const { discussion, messages } = result;
    const parts: string[] = [
      `# Discussion: ${discussion.topic}`,
      `ID: ${discussion.id} | Preset: ${discussion.preset ?? 'default'} | ${discussion.createdAt}`,
      '',
    ];

    let currentRound = 0;
    for (const msg of messages) {
      if (msg.round !== currentRound) {
        currentRound = msg.round;
        parts.push(`## Round ${currentRound}\n`);
      }
      parts.push(`### ${msg.agentName} (${msg.model})\n${msg.content}\n`);
    }

    if (discussion.synthesis) {
      parts.push(`## Synthesis\n\n${discussion.synthesis}`);
    }

    return {
      contents: [{ uri: uri.href, text: parts.join('\n'), mimeType: 'text/markdown' }],
    };
  },
);

// --- Start ---

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('Agora MCP server error:', err);
  process.exit(1);
});
