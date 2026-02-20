import type { RoundtableConfig, AgentDefinition } from '../config/schema.js';
import { getProvider } from '../providers/router.js';
import type { TranscriptEntry, RoundtableEvent, DiscussionStats } from './types.js';
import { buildPanelistMessages, buildSynthesizerMessages } from './context.js';
import { getPanelists, getSynthesizer, isConcurrentRound } from './protocol.js';

/**
 * Estimate tokens from text length (rough: ~3.5 chars per token).
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

/**
 * Stream a single agent's response and collect the full text.
 */
async function streamAgent(
  agent: AgentDefinition,
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  onChunk: (chunk: string) => void,
): Promise<string> {
  const provider = getProvider(agent.model);
  const parts: string[] = [];

  for await (const chunk of provider.stream(messages, {
    temperature: agent.temperature ?? 0.7,
    maxTokens: agent.maxTokens ?? 1024,
  })) {
    parts.push(chunk);
    onChunk(chunk);
  }

  return parts.join('');
}

/**
 * Core roundtable discussion engine.
 * Yields typed events as the discussion progresses.
 */
export async function* runRoundtable(
  topic: string,
  config: RoundtableConfig,
): AsyncGenerator<RoundtableEvent> {
  const startTime = Date.now();
  const panelists = getPanelists(config.agents);
  const synthesizer = getSynthesizer(config.agents);

  if (panelists.length === 0) {
    yield { type: 'error', error: 'No panelist agents defined in config' };
    return;
  }

  if (!synthesizer) {
    yield { type: 'error', error: 'No synthesizer agent defined in config' };
    return;
  }

  const agentNames = [...panelists.map((a) => a.name), synthesizer.name];
  yield { type: 'roundtable_start', topic, agents: agentNames, maxRounds: config.maxRounds };

  const transcript: TranscriptEntry[] = [];
  let totalTokens = 0;

  // --- Discussion rounds ---
  for (let round = 1; round <= config.maxRounds; round++) {
    const concurrent = isConcurrentRound(round);
    yield { type: 'round_start', round, mode: concurrent ? 'concurrent' : 'sequential' };

    if (concurrent) {
      // Round 1: all panelists in parallel (no prior context to reference).
      // Chunks are buffered per agent since we can't yield from inside Promise.all.
      // After all complete, yield each agent's chunks + done event sequentially.
      const results = await Promise.allSettled(
        panelists.map(async (agent) => {
          const messages = buildPanelistMessages(agent, topic, transcript, round);
          const chunks: string[] = [];
          const response = await streamAgent(agent, messages, (chunk) => {
            chunks.push(chunk);
          });
          return { agent, response, chunks };
        }),
      );

      // Yield results in panelist order (Promise.allSettled preserves order)
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const agent = panelists[i]; // Safe: allSettled preserves input order

        if (result.status === 'fulfilled') {
          const { response, chunks } = result.value;

          yield { type: 'agent_start', agentId: agent.id, agentName: agent.name, round };
          for (const chunk of chunks) {
            yield { type: 'agent_chunk', agentId: agent.id, text: chunk };
          }

          totalTokens += estimateTokens(response);
          transcript.push({
            agentId: agent.id,
            agentName: agent.name,
            round,
            response,
            model: agent.model,
          });

          yield {
            type: 'agent_done',
            agentId: agent.id,
            agentName: agent.name,
            fullResponse: response,
            round,
            model: agent.model,
          };
        } else {
          yield {
            type: 'error',
            agentId: agent.id,
            error: `Agent ${agent.name} failed: ${result.reason}`,
          };
        }
      }
    } else {
      // Round 2+: sequential — each agent sees all prior responses including
      // earlier agents in the current round.
      for (const agent of panelists) {
        yield { type: 'agent_start', agentId: agent.id, agentName: agent.name, round };

        try {
          const messages = buildPanelistMessages(agent, topic, transcript, round);
          const provider = getProvider(agent.model);
          let fullResponse = '';

          for await (const chunk of provider.stream(messages, {
            temperature: agent.temperature ?? 0.7,
            maxTokens: agent.maxTokens ?? 1024,
          })) {
            fullResponse += chunk;
            yield { type: 'agent_chunk', agentId: agent.id, text: chunk };
          }

          totalTokens += estimateTokens(fullResponse);
          transcript.push({
            agentId: agent.id,
            agentName: agent.name,
            round,
            response: fullResponse,
            model: agent.model,
          });

          yield {
            type: 'agent_done',
            agentId: agent.id,
            agentName: agent.name,
            fullResponse,
            round,
            model: agent.model,
          };
        } catch (err) {
          yield {
            type: 'error',
            agentId: agent.id,
            error: `Agent ${agent.name} failed: ${err}`,
          };
        }
      }
    }

    yield { type: 'round_end', round };
  }

  // --- Synthesis ---
  yield { type: 'synthesis_start', agentName: synthesizer.name, model: synthesizer.model };

  try {
    const synthMessages = buildSynthesizerMessages(synthesizer, topic, transcript);
    const provider = getProvider(synthesizer.model);
    let synthesisText = '';

    for await (const chunk of provider.stream(synthMessages, {
      temperature: synthesizer.temperature ?? 0.3,
      maxTokens: synthesizer.maxTokens ?? 2048,
    })) {
      synthesisText += chunk;
      yield { type: 'synthesis_chunk', text: chunk };
    }

    totalTokens += estimateTokens(synthesisText);
    yield { type: 'synthesis_done', answer: synthesisText };

    const stats: DiscussionStats = {
      totalRounds: config.maxRounds,
      totalAgents: panelists.length + 1,
      totalTokensEstimate: totalTokens,
      durationMs: Date.now() - startTime,
    };

    yield { type: 'roundtable_done', answer: synthesisText, stats };
  } catch (err) {
    yield { type: 'error', error: `Synthesizer failed: ${err}` };
  }
}
