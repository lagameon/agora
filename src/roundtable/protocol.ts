import type { AgentDefinition } from '../config/schema.js';

/**
 * Get panelist agents in speaking order.
 * Panelists speak in the order they appear in the config.
 */
export function getPanelists(agents: AgentDefinition[]): AgentDefinition[] {
  return agents.filter((a) => a.role === 'panelist');
}

/**
 * Get the synthesizer agent (there should be exactly one).
 */
export function getSynthesizer(agents: AgentDefinition[]): AgentDefinition | undefined {
  return agents.find((a) => a.role === 'synthesizer');
}

/**
 * Get the moderator agent (optional).
 */
export function getModerator(agents: AgentDefinition[]): AgentDefinition | undefined {
  return agents.find((a) => a.role === 'moderator');
}

/**
 * Determine if a round should run concurrently.
 * Round 1: concurrent (no prior context to reference).
 * Round 2+: sequential (agents see earlier responses in the same round).
 */
export function isConcurrentRound(round: number): boolean {
  return round === 1;
}
