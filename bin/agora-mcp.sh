#!/bin/bash
# Wrapper script to launch Agora MCP server with user's environment variables.
# MCP servers spawned by Claude Code don't inherit ~/.zshrc exports,
# so this script sources them before starting the server.

# Source user's shell profile to get API keys
if [ -f "$HOME/.zshrc" ]; then
  source "$HOME/.zshrc" 2>/dev/null
elif [ -f "$HOME/.bashrc" ]; then
  source "$HOME/.bashrc" 2>/dev/null
elif [ -f "$HOME/.profile" ]; then
  source "$HOME/.profile" 2>/dev/null
fi

# Launch Agora MCP server
exec bun run "$(dirname "$0")/../src/mcp.ts" "$@"
