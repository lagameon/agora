export interface TranscriptEntry {
  agentId: string;
  agentName: string;
  round: number;
  response: string;
  model: string;
}

export interface DiscussionStats {
  totalRounds: number;
  totalAgents: number;
  totalTokensEstimate: number;
  durationMs: number;
}

export type RoundtableEvent =
  | { type: 'roundtable_start'; topic: string; agents: string[]; maxRounds: number }
  | { type: 'round_start'; round: number; mode: 'concurrent' | 'sequential' }
  | { type: 'agent_start'; agentId: string; agentName: string; round: number }
  | { type: 'agent_chunk'; agentId: string; text: string }
  | { type: 'agent_done'; agentId: string; agentName: string; fullResponse: string; round: number; model: string }
  | { type: 'round_end'; round: number }
  | { type: 'synthesis_start'; agentName: string; model: string }
  | { type: 'synthesis_chunk'; text: string }
  | { type: 'synthesis_done'; answer: string }
  | { type: 'roundtable_done'; answer: string; stats: DiscussionStats }
  | { type: 'error'; agentId?: string; error: string };
