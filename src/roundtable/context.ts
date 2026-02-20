import type { AgentDefinition } from '../config/schema.js';
import type { ChatMessage } from '../providers/types.js';
import type { TranscriptEntry } from './types.js';

/**
 * Interpolate {{topic}} and other template variables in a string.
 */
export function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

/**
 * Format transcript entries into a group-chat-style conversation.
 */
function formatTranscript(entries: TranscriptEntry[]): string {
  if (entries.length === 0) return '';

  const byRound = new Map<number, TranscriptEntry[]>();
  for (const entry of entries) {
    const list = byRound.get(entry.round) ?? [];
    list.push(entry);
    byRound.set(entry.round, list);
  }

  const parts: string[] = [];
  for (const [round, roundEntries] of byRound) {
    parts.push(`### Round ${round}`);
    for (const entry of roundEntries) {
      parts.push(`**${entry.agentName}**: ${entry.response}`);
    }
  }

  return parts.join('\n\n');
}

/**
 * Determine if a model is an Anthropic model (for prompt caching).
 */
function isAnthropicModel(model: string): boolean {
  return model.startsWith('claude-');
}

/** Apply cache_control if the model is Anthropic */
function withCache(msg: ChatMessage, model: string): ChatMessage {
  if (isAnthropicModel(model)) {
    return { ...msg, cache_control: { type: 'ephemeral' } };
  }
  return msg;
}

/**
 * Build the message array for a panelist agent in a given round.
 *
 * Prompt caching strategy for Anthropic:
 *   - system prompt: cached (same across all calls for this agent)
 *   - accumulated context (topic + prior rounds): cached as a separate message
 *   - current round entries + turn prompt: NOT cached (changes per agent)
 *
 * This maximizes cache hits: within a round, sequential agents share the
 * same system + accumulated context prefix.
 */
export function buildPanelistMessages(
  agent: AgentDefinition,
  topic: string,
  transcript: TranscriptEntry[],
  currentRound: number,
): ChatMessage[] {
  const vars = { topic };
  const systemPrompt = interpolate(agent.systemPrompt, vars);

  // System prompt — always cached for Anthropic
  const systemMsg = withCache(
    { role: 'system', content: systemPrompt },
    agent.model,
  );

  const priorEntries = transcript.filter((e) => e.round < currentRound);
  const currentRoundEntries = transcript.filter((e) => e.round === currentRound);

  if (priorEntries.length === 0 && currentRoundEntries.length === 0) {
    // Round 1 with no prior context — simple prompt
    return [
      systemMsg,
      { role: 'user', content: `## Topic\n\n${topic}\n\nShare your perspective on this topic.` },
    ];
  }

  const messages: ChatMessage[] = [systemMsg];

  // Accumulated context: topic + all prior rounds — CACHEABLE
  // This is identical across agents in the same round, so Anthropic's
  // prefix-matching cache gives us ~90% cost reduction.
  const accumulatedParts: string[] = [`## Topic\n\n${topic}`];
  if (priorEntries.length > 0) {
    accumulatedParts.push(`## Previous Discussion\n\n${formatTranscript(priorEntries)}`);
  }
  messages.push(
    withCache({ role: 'user', content: accumulatedParts.join('\n\n') }, agent.model),
  );

  // Current round context + turn prompt — NOT cached (changes per agent)
  const turnParts: string[] = [];
  if (currentRoundEntries.length > 0) {
    turnParts.push(`## Current Round ${currentRound}\n\n${formatTranscript(currentRoundEntries)}`);
  }
  turnParts.push(`It's your turn in Round ${currentRound}. Respond to the topic, considering what others have said. Be concise and insightful.`);
  messages.push({ role: 'user', content: turnParts.join('\n\n') });

  return messages;
}

/**
 * Build the message array for the synthesizer agent.
 *
 * Prompt caching: system prompt + full discussion transcript are cached.
 * The synthesis instruction is in the same message (small overhead, simpler structure).
 */
export function buildSynthesizerMessages(
  agent: AgentDefinition,
  topic: string,
  transcript: TranscriptEntry[],
): ChatMessage[] {
  const vars = { topic };
  const systemPrompt = interpolate(agent.systemPrompt, vars);

  const systemMsg = withCache(
    { role: 'system', content: systemPrompt },
    agent.model,
  );

  const fullTranscript = formatTranscript(transcript);

  // Cache the full discussion context for Anthropic
  const contextMsg = withCache(
    {
      role: 'user',
      content: `## Topic\n\n${topic}\n\n## Full Discussion\n\n${fullTranscript}\n\n---\n\nSynthesize the above discussion into a clear, balanced, actionable final answer. Incorporate the best insights from all participants.`,
    },
    agent.model,
  );

  return [systemMsg, contextMsg];
}
