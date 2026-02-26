import type { RoundtableConfig, AgentDefinition } from '../config/schema.js';
import { getProvider } from '../providers/router.js';
import type { TranscriptEntry, RoundtableEvent, DiscussionStats } from './types.js';
import { buildPanelistMessages, buildSynthesizerMessages } from './context.js';
import { getPanelists, getSynthesizer, isConcurrentRound } from './protocol.js';

const DEFAULT_AGENT_TIMEOUT_S = 120;

/**
 * Estimate tokens from text length (rough: ~3.5 chars per token).
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

/**
 * Race a promise against a timeout. Rejects with a descriptive error on timeout.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${(timeoutMs / 1000).toFixed(0)}s`));
    }, timeoutMs);

    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/**
 * Collect all chunks from a streaming agent, with a hard timeout.
 */
async function streamAgentWithTimeout(
  agent: AgentDefinition,
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  onChunk: (chunk: string) => void,
  timeoutMs: number,
): Promise<string> {
  const provider = getProvider(agent.model);

  const work = async (): Promise<string> => {
    const parts: string[] = [];
    for await (const chunk of provider.stream(messages, {
      temperature: agent.temperature ?? 0.7,
      maxTokens: agent.maxTokens ?? 1024,
    })) {
      parts.push(chunk);
      onChunk(chunk);
    }
    return parts.join('');
  };

  return withTimeout(work(), timeoutMs, `${agent.name} (${agent.model})`);
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
  const timeoutMs = (config.agentTimeout ?? DEFAULT_AGENT_TIMEOUT_S) * 1000;

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
      const results = await Promise.allSettled(
        panelists.map(async (agent) => {
          const messages = buildPanelistMessages(agent, topic, transcript, round);
          const chunks: string[] = [];
          const response = await streamAgentWithTimeout(agent, messages, (chunk) => {
            chunks.push(chunk);
          }, timeoutMs);
          return { agent, response, chunks };
        }),
      );

      // Yield results in panelist order (Promise.allSettled preserves order)
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const agent = panelists[i];

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
      // Round 2+: sequential — each agent sees all prior responses.
      for (const agent of panelists) {
        yield { type: 'agent_start', agentId: agent.id, agentName: agent.name, round };

        try {
          const messages = buildPanelistMessages(agent, topic, transcript, round);
          const provider = getProvider(agent.model);
          let fullResponse = '';

          const work = async (): Promise<string> => {
            for await (const chunk of provider.stream(messages, {
              temperature: agent.temperature ?? 0.7,
              maxTokens: agent.maxTokens ?? 1024,
            })) {
              fullResponse += chunk;
              // Can't yield from inside async — chunks are emitted below via done event
            }
            return fullResponse;
          };

          fullResponse = await withTimeout(work(), timeoutMs, `${agent.name} (${agent.model})`);

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

    const synthWork = async (): Promise<string> => {
      for await (const chunk of provider.stream(synthMessages, {
        temperature: synthesizer.temperature ?? 0.3,
        maxTokens: synthesizer.maxTokens ?? 2048,
      })) {
        synthesisText += chunk;
      }
      return synthesisText;
    };

    synthesisText = await withTimeout(synthWork(), timeoutMs, `${synthesizer.name} (${synthesizer.model})`);

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
