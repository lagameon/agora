import type { RoundtableEvent } from '../roundtable/types.js';

// ANSI color codes for agent names
const COLORS = [
  '\x1b[36m',  // cyan
  '\x1b[33m',  // yellow
  '\x1b[35m',  // magenta
  '\x1b[32m',  // green
  '\x1b[34m',  // blue
  '\x1b[91m',  // bright red
];
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';

const agentColors = new Map<string, string>();
let colorIndex = 0;

function getColor(agentId: string): string {
  let color = agentColors.get(agentId);
  if (!color) {
    color = COLORS[colorIndex % COLORS.length];
    agentColors.set(agentId, color);
    colorIndex++;
  }
  return color;
}

/**
 * Render roundtable events to the terminal with colors.
 */
export async function renderToTerminal(events: AsyncGenerator<RoundtableEvent>): Promise<void> {
  let currentAgentId: string | null = null;

  for await (const event of events) {
    switch (event.type) {
      case 'roundtable_start': {
        console.log(`\n${BOLD}--- Roundtable: "${event.topic}" ---${RESET}`);
        console.log(`${DIM}Agents: ${event.agents.join(', ')}${RESET}`);
        console.log(`${DIM}Max rounds: ${event.maxRounds}${RESET}\n`);
        break;
      }

      case 'round_start': {
        console.log(`${BOLD}=== Round ${event.round} ${DIM}(${event.mode})${RESET}${BOLD} ===${RESET}\n`);
        break;
      }

      case 'agent_start': {
        const color = getColor(event.agentId);
        console.log(`${color}${BOLD}[${event.agentName}]${RESET}`);
        currentAgentId = event.agentId;
        break;
      }

      case 'agent_chunk': {
        if (event.agentId === currentAgentId) {
          process.stdout.write(event.text);
        }
        break;
      }

      case 'agent_done': {
        if (event.agentId === currentAgentId) {
          console.log('\n');
        } else {
          // Concurrent mode: agent finished but wasn't the "current" streaming one.
          // Print full response with header.
          const color = getColor(event.agentId);
          console.log(`${color}${BOLD}[${event.agentName}]${RESET}`);
          console.log(event.fullResponse);
          console.log();
        }
        currentAgentId = null;
        break;
      }

      case 'round_end': {
        // Spacer between rounds
        break;
      }

      case 'synthesis_start': {
        console.log(`${BOLD}=== Synthesis ===${RESET}`);
        const color = getColor('synthesizer');
        console.log(`${color}${BOLD}[${event.agentName}]${RESET} ${DIM}(${event.model})${RESET}`);
        break;
      }

      case 'synthesis_chunk': {
        process.stdout.write(event.text);
        break;
      }

      case 'synthesis_done': {
        console.log('\n');
        break;
      }

      case 'roundtable_done': {
        const s = event.stats;
        const duration = (s.durationMs / 1000).toFixed(1);
        console.log(
          `${DIM}--- Done (${s.totalRounds} rounds, ${s.totalAgents} agents, ~${s.totalTokensEstimate} tokens, ${duration}s) ---${RESET}\n`,
        );
        break;
      }

      case 'error': {
        const prefix = event.agentId ? `[${event.agentId}] ` : '';
        console.error(`\x1b[31m${prefix}Error: ${event.error}${RESET}`);
        break;
      }
    }
  }
}
