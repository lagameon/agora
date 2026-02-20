#!/usr/bin/env bun

import { getProvider, listProviders } from './providers/router.js';
import { DEFAULT_MODEL } from './config/defaults.js';
import { loadPreset, listPresets, interpolateConfig } from './config/loader.js';
import { DEFAULT_PRESET } from './agents/presets.js';
import { runRoundtable } from './roundtable/engine.js';
import { renderToTerminal } from './output/terminal.js';
import { DiscussionRecorder, listDiscussions, getDiscussion } from './history/store.js';
import type { RoundtableConfig } from './config/schema.js';
import type { RoundtableEvent } from './roundtable/types.js';

const USAGE = `
agora — Multi-agent roundtable discussion tool

Usage:
  agora ask <question> [--model <model>]     Quick single-model query
  agora discuss <topic> [options]             Run a roundtable discussion
  agora presets                               List available presets
  agora history [--id <id>]                   View discussion history
  agora mcp                                   Start MCP server (stdio)

Options:
  --model <model>    Model to use (default: ${DEFAULT_MODEL})
  --preset <name>    Preset name (default, research, debate)
  --rounds <n>       Maximum discussion rounds (default: 2)
  --help, -h         Show this help message

Supported models:
  ${listProviders().join('\n  ')}
`.trim();

function parseArgs(args: string[]): { command: string; positional: string; flags: Record<string, string> } {
  const command = args[0] ?? 'help';
  const flags: Record<string, string> = {};
  const positional: string[] = [];

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = 'true';
      }
    } else if (arg === '-h') {
      flags['help'] = 'true';
    } else {
      positional.push(arg);
    }
  }

  return { command, positional: positional.join(' '), flags };
}

async function handleAsk(question: string, model: string): Promise<void> {
  if (!question) {
    console.error('Error: question is required. Usage: agora ask "your question"');
    process.exit(1);
  }

  const provider = getProvider(model);
  console.log(`\x1b[2m[${model}]\x1b[0m\n`);

  for await (const chunk of provider.stream(
    [{ role: 'user', content: question }],
    { temperature: 0.7, maxTokens: 2048 },
  )) {
    process.stdout.write(chunk);
  }
  console.log('\n');
}

function resolveConfig(presetName: string | undefined, topic: string): RoundtableConfig {
  let config: RoundtableConfig;
  if (presetName) {
    try {
      config = loadPreset(presetName);
    } catch {
      console.error(`Warning: preset "${presetName}" not found, using built-in default.`);
      config = { ...DEFAULT_PRESET };
    }
  } else {
    try {
      config = loadPreset('default');
    } catch {
      config = { ...DEFAULT_PRESET };
    }
  }
  return interpolateConfig(config, topic);
}

/**
 * Wrap the roundtable generator to also record events to SQLite.
 */
async function* withRecording(
  events: AsyncGenerator<RoundtableEvent>,
  recorder: DiscussionRecorder,
): AsyncGenerator<RoundtableEvent> {
  for await (const event of events) {
    recorder.handleEvent(event);
    yield event;
  }
}

async function main(): Promise<void> {
  const { command, positional, flags } = parseArgs(process.argv.slice(2));

  if (flags['help'] || command === 'help' || command === '--help' || command === '-h') {
    console.log(USAGE);
    return;
  }

  switch (command) {
    case 'ask': {
      const model = flags['model'] ?? DEFAULT_MODEL;
      await handleAsk(positional, model);
      break;
    }

    case 'discuss': {
      if (!positional) {
        console.error('Error: topic is required. Usage: agora discuss "your topic"');
        process.exit(1);
      }
      const presetName = flags['preset'];
      const config = resolveConfig(presetName, positional);
      if (flags['rounds']) {
        config.maxRounds = parseInt(flags['rounds'], 10);
      }
      const recorder = new DiscussionRecorder(positional, presetName);
      const events = runRoundtable(positional, config);
      await renderToTerminal(withRecording(events, recorder));
      console.log(`\x1b[2mDiscussion saved: ${recorder.discussionId}\x1b[0m`);
      break;
    }

    case 'presets': {
      const presets = listPresets();
      if (presets.length === 0) {
        console.log('No presets found.');
      } else {
        console.log('\nAvailable presets:\n');
        for (const p of presets) {
          const badge = p.source === 'user' ? '\x1b[33m[user]\x1b[0m' : '\x1b[2m[builtin]\x1b[0m';
          console.log(`  \x1b[1m${p.name}\x1b[0m ${badge}`);
          if (p.description) console.log(`    ${p.description}`);
        }
        console.log('\nUsage: agora discuss "topic" --preset <name>\n');
      }
      break;
    }

    case 'history': {
      const id = flags['id'];
      if (id) {
        // Show specific discussion
        const result = getDiscussion(id);
        if (!result) {
          console.error(`Discussion "${id}" not found.`);
          process.exit(1);
        }
        const { discussion, messages } = result;
        console.log(`\n\x1b[1mTopic:\x1b[0m ${discussion.topic}`);
        console.log(`\x1b[2mID: ${discussion.id} | Preset: ${discussion.preset ?? 'default'} | ${discussion.createdAt}\x1b[0m`);
        if (discussion.durationMs) {
          console.log(`\x1b[2mDuration: ${(discussion.durationMs / 1000).toFixed(1)}s | Tokens: ~${discussion.totalTokens}\x1b[0m`);
        }
        console.log();

        let currentRound = 0;
        for (const msg of messages) {
          if (msg.round !== currentRound) {
            currentRound = msg.round;
            console.log(`\x1b[1m=== Round ${currentRound} ===\x1b[0m\n`);
          }
          console.log(`\x1b[36m[${msg.agentName}]\x1b[0m \x1b[2m(${msg.model})\x1b[0m`);
          console.log(msg.content);
          console.log();
        }

        if (discussion.synthesis) {
          console.log('\x1b[1m=== Synthesis ===\x1b[0m\n');
          console.log(discussion.synthesis);
          console.log();
        }
      } else {
        // List recent discussions
        const discussions = listDiscussions();
        if (discussions.length === 0) {
          console.log('No discussions yet. Run: agora discuss "your topic"');
        } else {
          console.log('\nRecent discussions:\n');
          for (const d of discussions) {
            const duration = d.durationMs ? `${(d.durationMs / 1000).toFixed(0)}s` : '?';
            const tokens = d.totalTokens ? `~${d.totalTokens}t` : '';
            console.log(`  \x1b[1m${d.id}\x1b[0m  ${d.topic}`);
            console.log(`    \x1b[2m${d.createdAt} | ${d.preset ?? 'default'} | ${duration} ${tokens}\x1b[0m`);
          }
          console.log('\nView details: agora history --id <id>\n');
        }
      }
      break;
    }

    case 'mcp': {
      // Import and start MCP server
      await import('./mcp.js');
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.log(USAGE);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
