import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, basename } from 'path';
import YAML from 'yaml';
import { RoundtableConfigSchema, type RoundtableConfig } from './schema.js';

/** Project-level config from .agora/config.yaml */
export interface ProjectConfig {
  defaultModel?: string;
  defaultPreset?: string;
}

/**
 * Load project-level config from .agora/config.yaml (cwd), then ~/.agora/config.yaml.
 * Project-local overrides user-global.
 */
export function loadProjectConfig(): ProjectConfig {
  const candidates: string[] = [];

  // Project-local (highest priority)
  candidates.push(join(process.cwd(), '.agora', 'config.yaml'));

  // User global
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  if (home) {
    candidates.push(join(home, '.agora', 'config.yaml'));
  }

  const merged: ProjectConfig = {};

  // Read in reverse so project-local overwrites user-global
  for (const filePath of [...candidates].reverse()) {
    if (!existsSync(filePath)) continue;
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const parsed = YAML.parse(raw) as Record<string, unknown>;
      if (parsed.defaultModel && typeof parsed.defaultModel === 'string') {
        merged.defaultModel = parsed.defaultModel;
      }
      if (parsed.defaultPreset && typeof parsed.defaultPreset === 'string') {
        merged.defaultPreset = parsed.defaultPreset;
      }
    } catch {
      // Ignore malformed config
    }
  }

  return merged;
}

/**
 * Directories to search for presets, in priority order (highest first):
 * 1. Project-local: ./.agora/presets/  (cwd)
 * 2. User global:   ~/.agora/presets/
 * 3. Builtin:       <agora>/presets/
 */
function getPresetDirs(): string[] {
  const dirs: string[] = [];

  // Project-local presets (highest priority)
  const cwd = process.cwd();
  dirs.push(join(cwd, '.agora', 'presets'));

  // User global presets
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  if (home) {
    dirs.push(join(home, '.agora', 'presets'));
  }

  // Builtin presets (lowest priority)
  dirs.push(join(import.meta.dir, '..', '..', 'presets'));
  return dirs;
}

/** Determine the source label for a preset directory */
function getSourceLabel(dir: string): string {
  if (!dir.includes('.agora')) return 'builtin';
  const cwd = process.cwd();
  if (dir.startsWith(join(cwd, '.agora'))) return 'project';
  return 'user';
}

/**
 * Load a preset by name from the preset directories.
 * Searches project-local first, then user global, then builtin.
 */
export function loadPreset(name: string): RoundtableConfig {
  for (const dir of getPresetDirs()) {
    const filePath = join(dir, `${name}.yaml`);
    if (existsSync(filePath)) {
      const raw = readFileSync(filePath, 'utf-8');
      const parsed = YAML.parse(raw);
      return RoundtableConfigSchema.parse(parsed);
    }
  }
  throw new Error(`Preset "${name}" not found. Run "agora presets" to see available presets.`);
}

/**
 * List all available presets from all directories.
 * Returns name + description + source (project / user / builtin).
 * Higher-priority presets shadow lower-priority ones with the same name.
 */
export function listPresets(): Array<{ name: string; description?: string; source: string }> {
  const seen = new Set<string>();
  const presets: Array<{ name: string; description?: string; source: string }> = [];

  for (const dir of getPresetDirs()) {
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir).filter((f) => f.endsWith('.yaml'));
    const source = getSourceLabel(dir);

    for (const file of files) {
      const name = basename(file, '.yaml');
      if (seen.has(name)) continue;
      seen.add(name);

      try {
        const raw = readFileSync(join(dir, file), 'utf-8');
        const parsed = YAML.parse(raw);
        presets.push({
          name,
          description: parsed.description ?? parsed.name ?? name,
          source,
        });
      } catch {
        presets.push({ name, source });
      }
    }
  }

  return presets;
}

/**
 * Interpolate {{topic}} in all agent systemPrompts within a config.
 */
export function interpolateConfig(config: RoundtableConfig, topic: string): RoundtableConfig {
  return {
    ...config,
    agents: config.agents.map((agent) => ({
      ...agent,
      systemPrompt: agent.systemPrompt.replace(/\{\{topic\}\}/g, topic),
    })),
  };
}
