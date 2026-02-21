# Agora

Multi-agent roundtable discussion tool. Post a question, multiple AI agents discuss it from different perspectives, and a synthesizer produces a final answer.

Works as a **CLI tool** and as an **MCP server** for Claude Code integration.

## Features

- **Multi-agent discussions** — configurable panels of AI agents with different roles and models
- **Multi-provider** — Anthropic, OpenAI, Google Gemini, DeepSeek, xAI/Grok, Ollama (local)
- **YAML presets** — define custom agent panels with `{{topic}}` template interpolation
- **Concurrent Round 1** — all panelists respond in parallel, ~50% faster
- **Prompt caching** — Anthropic `cache_control` for ~90% cost reduction on cached tokens
- **Discussion history** — SQLite persistence via `bun:sqlite`, queryable and replayable
- **MCP server** — integrate with Claude Code for on-demand AI roundtables
- **Streaming output** — color-coded terminal rendering with real-time streaming

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) runtime (v1.0+)
- At least one LLM API key

### Install

```bash
git clone https://github.com/lagameon/agora.git
cd agora
bun install
```

### Configure API Keys

Create a `.env` file in the project root:

```bash
cp .env.example .env
# Edit .env with your API keys
```

```env
# At least one required
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=AI...

# Optional
DEEPSEEK_API_KEY=sk-...
XAI_API_KEY=xai-...
OLLAMA_BASE_URL=http://localhost:11434/v1
```

> **Note:** The default preset uses `gpt-4.1-mini` — set `OPENAI_API_KEY` to get started quickly. The `research` preset uses Claude + GPT + Gemini and requires all three keys.

### Run

```bash
# Quick single-model query
bun run src/cli.ts ask "What is quantitative trading?"

# Roundtable discussion (default preset: 3 agents)
bun run src/cli.ts discuss "React vs Vue in 2026?"

# Use a specific preset
bun run src/cli.ts discuss "Should AI replace most programming jobs?" --preset debate
```

## CLI Commands

```
agora ask <question> [--model <model>]     Quick single-model query
agora discuss <topic> [options]             Run a roundtable discussion
agora presets                               List available presets
agora history [--id <id>]                   View discussion history
agora mcp                                   Start MCP server (stdio)
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `--model <model>` | Model for `ask` command | `gpt-4.1-mini` |
| `--preset <name>` | Preset for `discuss` command | `default` |
| `--rounds <n>` | Max discussion rounds | `2` |

### Examples

```bash
# Ask with a specific model
bun run src/cli.ts ask "Explain transformers" --model claude-sonnet-4-5

# Research panel (Claude + GPT + Gemini)
bun run src/cli.ts discuss "Will the US dollar lose reserve currency status?" --preset research

# Adversarial debate with 3 rounds
bun run src/cli.ts discuss "Cryptocurrency is the future of money" --preset debate --rounds 3

# View discussion history
bun run src/cli.ts history
bun run src/cli.ts history --id <discussion_id>
```

## Built-in Presets

| Preset | Description | Agents | Models |
|--------|-------------|--------|--------|
| **default** | Balanced 3-agent panel | Analyst + Critic + Synthesizer | gpt-4.1-mini |
| **research** | Deep research panel | Domain Expert + Methodologist + Contrarian + Synthesizer | Claude Sonnet + GPT-4.1 + Gemini Flash |
| **debate** | Adversarial debate | Proponent + Opponent + Judge | GPT-4.1 + Claude Sonnet |

## Custom Presets

Presets are loaded from three directories (highest priority first):

| Priority | Directory | Scope |
|----------|-----------|-------|
| 1 | `./.agora/presets/` | Project-local (per-repo) |
| 2 | `~/.agora/presets/` | User global (shared) |
| 3 | `<agora>/presets/` | Built-in |

Same-name presets are shadowed by higher priority. This lets each project override the global defaults.

Create YAML files in `~/.agora/presets/` (global) or `.agora/presets/` in your project root (project-local):

```yaml
name: "My Team"
description: "Custom panel for technical decisions"
maxRounds: 2

agents:
  - id: architect
    name: "The Architect"
    role: panelist
    model: claude-sonnet-4-5
    systemPrompt: |
      You are a software architect evaluating: {{topic}}.
      Focus on system design, scalability, and long-term maintainability.
    temperature: 0.6
    maxTokens: 1024

  - id: pragmatist
    name: "The Pragmatist"
    role: panelist
    model: gpt-4.1
    systemPrompt: |
      You are a pragmatic engineer evaluating: {{topic}}.
      Focus on implementation complexity, developer experience, and time-to-ship.
    temperature: 0.7
    maxTokens: 1024

  - id: synthesizer
    name: "Decision Maker"
    role: synthesizer
    model: claude-sonnet-4-5
    systemPrompt: |
      Synthesize the discussion about: {{topic}}.
      Weigh all perspectives and produce an actionable recommendation.
    temperature: 0.3
    maxTokens: 2048
```

Save as `~/.agora/presets/my-team.yaml`, then:

```bash
bun run src/cli.ts discuss "Should we migrate to microservices?" --preset my-team
```

### Preset Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | No | Display name |
| `description` | string | No | Description |
| `maxRounds` | number | No | Max discussion rounds (default: 2, max: 10) |
| `agents` | array | Yes | At least 2 agents, one must be `synthesizer` |

### Agent Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique identifier |
| `name` | string | Yes | Display name |
| `role` | string | Yes | `panelist`, `moderator`, or `synthesizer` |
| `model` | string | Yes | Model identifier (see supported models) |
| `systemPrompt` | string | Yes | System prompt, supports `{{topic}}` |
| `temperature` | number | No | 0-2 (default: 0.7) |
| `maxTokens` | number | No | Max response tokens (default: 1024) |

## Supported Models

| Prefix | Provider | Examples |
|--------|----------|----------|
| `claude-*` | Anthropic | `claude-sonnet-4-5`, `claude-haiku-4-5` |
| `gpt-*` | OpenAI | `gpt-4.1`, `gpt-4.1-mini` |
| `o1-*` / `o3-*` / `o4-*` | OpenAI | `o3-mini`, `o4-mini` |
| `gemini-*` | Google | `gemini-2.5-flash`, `gemini-2.5-pro` |
| `deepseek-*` | DeepSeek | `deepseek-chat`, `deepseek-reasoner` |
| `grok-*` | xAI | `grok-3` |
| `ollama:*` | Ollama (local) | `ollama:llama3`, `ollama:mistral` |

## MCP Server (Claude Code Integration)

Agora can run as an MCP server, allowing Claude Code to invoke AI roundtables on demand.

### Configure

Add to your project's `.mcp.json` (or `~/.claude/mcp.json` for global access):

```json
{
  "mcpServers": {
    "agora": {
      "command": "bun",
      "args": ["run", "/path/to/agora/src/mcp.ts"]
    }
  }
}
```

> API keys should be set in your shell environment or passed via the `env` field.

### MCP Tools

| Tool | Description |
|------|-------------|
| `agora_discuss(topic, preset?, maxRounds?)` | Run a roundtable discussion |
| `agora_ask(question, model?)` | Quick single-model query |

### MCP Resources

| URI | Description |
|-----|-------------|
| `agora://presets` | List all available presets |
| `agora://history` | Recent discussion list |
| `agora://discussions/{id}` | Full discussion transcript |

### Usage in Claude Code

Just ask Claude naturally:

- *"Use agora to discuss React vs Vue"*
- *"Run an agora research panel on the future of quantum computing"*
- *"Ask agora: what is the MCP protocol?"*

## Architecture

```
Question ──→ Round 1 (concurrent): All panelists respond in parallel
               │
               ▼
             Round 2+ (sequential): Each agent sees all prior responses
               │
               ▼
             Synthesizer: Produces final answer from full discussion
               │
               ▼
             SQLite: Discussion saved automatically
```

### Key Design Decisions

- **No LangChain** — direct SDK calls for full control over prompt caching and streaming
- **AsyncGenerator engine** — CLI, MCP server, and history store all consume the same typed event stream
- **Provider prefix routing** — model name prefix determines which SDK to use
- **Anthropic prompt caching** — `cache_control` headers on system prompts and accumulated context for ~90% cost reduction
- **Round 1 concurrent** — `Promise.allSettled` fires all panelists in parallel (no prior context needed), ~50% speed improvement
- **bun:sqlite** — zero-dependency persistence (built into Bun), two tables: `discussions` and `messages`

### Project Structure

```
agora/
├── src/
│   ├── cli.ts                    # CLI entry point
│   ├── index.ts                  # Library public API
│   ├── mcp.ts                    # MCP server (stdio transport)
│   ├── config/
│   │   ├── schema.ts             # Zod schemas for validation
│   │   ├── loader.ts             # YAML preset loader
│   │   └── defaults.ts           # Default settings
│   ├── providers/
│   │   ├── router.ts             # Model prefix → provider factory
│   │   ├── types.ts              # ChatProvider interface
│   │   └── retry.ts              # Exponential backoff
│   ├── agents/
│   │   ├── types.ts              # Agent types
│   │   └── presets.ts            # Built-in default preset
│   ├── roundtable/
│   │   ├── engine.ts             # Core discussion engine
│   │   ├── protocol.ts           # Round logic & concurrency
│   │   ├── context.ts            # Message building + prompt caching
│   │   └── types.ts              # Event types
│   ├── history/
│   │   └── store.ts              # bun:sqlite persistence
│   └── output/
│       └── terminal.ts           # Color-coded terminal renderer
└── presets/
    ├── default.yaml              # Balanced 3-agent panel
    ├── research.yaml             # Deep research panel
    └── debate.yaml               # Adversarial debate
```

## Programmatic API

Agora can be used as a library:

```typescript
import { runRoundtable, loadPreset, interpolateConfig } from 'agora';

const topic = "Should we use GraphQL or REST?";
const config = interpolateConfig(loadPreset('default'), topic);

for await (const event of runRoundtable(topic, config)) {
  if (event.type === 'agent_done') {
    console.log(`${event.agentName}: ${event.fullResponse}`);
  }
  if (event.type === 'synthesis_done') {
    console.log(`Final answer: ${event.answer}`);
  }
}
```

## Data Storage

Discussion history is stored in `~/.agora/agora.db` (SQLite). This directory is created automatically on first run.

- Discussions are queryable via `agora history`
- Full transcripts available via `agora history --id <id>`
- Database is local-only and never transmitted anywhere

## License

MIT
