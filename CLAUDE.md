# Agora

Multi-agent roundtable discussion tool. Post a question, multiple AI agents discuss, synthesizer produces a final answer.

## Stack

- **Runtime**: Bun
- **Language**: TypeScript (ESNext, bundler module resolution)
- **LLM SDKs**: @anthropic-ai/sdk, openai, @google/generative-ai (direct calls, no LangChain)
- **Storage**: bun:sqlite (zero-dependency, built into Bun)
- **MCP**: @modelcontextprotocol/sdk (stdio transport)
- **Config**: Zod validation, YAML presets with `{{topic}}` interpolation

## Commands

```bash
bun run src/cli.ts ask "question"                    # Quick single-model query
bun run src/cli.ts discuss "topic"                   # Roundtable discussion
bun run src/cli.ts discuss "topic" --preset research # Use preset
bun run src/cli.ts presets                           # List presets
bun run src/cli.ts history                           # List discussions
bun run src/cli.ts mcp                               # Start MCP server
```

## Type Checking

```bash
./node_modules/.bin/tsc --noEmit
```

## Architecture

- `src/providers/` — Multi-provider abstraction (prefix routing: `claude-*` → Anthropic, `gpt-*` → OpenAI, `gemini-*` → Google, etc.)
- `src/roundtable/` — Discussion engine (AsyncGenerator yielding typed `RoundtableEvent` events)
- `src/config/` — Zod schemas + YAML preset loader
- `src/history/` — bun:sqlite persistence (two tables: `discussions`, `messages`)
- `src/mcp.ts` — MCP server for Claude Code integration
- `presets/` — YAML agent configuration presets

## Key Patterns

- **Round 1 concurrent** (`Promise.allSettled`), **Round 2+ sequential** (each agent sees prior responses)
- **Anthropic prompt caching** via `cache_control` on system prompts + accumulated context
- **MCP tools** collect full AsyncGenerator output (no streaming in MCP protocol)
- **Provider prefix routing** — model name prefix determines SDK factory
- **Exponential backoff** with rate-limit detection (429 status)
