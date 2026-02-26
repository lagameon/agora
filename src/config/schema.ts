import { z } from 'zod';

export const AgentRoleSchema = z.enum(['panelist', 'moderator', 'synthesizer']);

export const AgentDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: AgentRoleSchema,
  model: z.string().min(1),
  systemPrompt: z.string().min(1),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().positive().optional(),
});

export const RoundtableConfigSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  maxRounds: z.number().int().positive().max(10).default(2),
  /** Per-agent timeout in seconds. Default: 120. */
  agentTimeout: z.number().positive().optional(),
  agents: z.array(AgentDefinitionSchema).min(2).refine(
    (agents) => agents.some((a) => a.role === 'synthesizer'),
    { message: 'At least one agent must have role "synthesizer"' },
  ),
});

export type AgentRole = z.infer<typeof AgentRoleSchema>;
export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;
export type RoundtableConfig = z.infer<typeof RoundtableConfigSchema>;
