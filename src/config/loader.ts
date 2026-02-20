import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, basename } from 'path';
import YAML from 'yaml';
import { RoundtableConfigSchema, type RoundtableConfig } from './schema.js';

/** Directories to search for presets, in priority order (user overrides builtin) */
function getPresetDirs(): string[] {
  const dirs: string[] = [];
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  if (home) {
    dirs.push(join(home, '.agora', 'presets'));
  }
  // Builtin presets (relative to project root)
  dirs.push(join(import.meta.dir, '..', '..', 'presets'));
  return dirs;
}

/**
 * Load a preset by name from the preset directories.
 * Searches user dir first, then builtin dir.
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
 * Returns name + description + source path.
 */
export function listPresets(): Array<{ name: string; description?: string; source: string }> {
  const seen = new Set<string>();
  const presets: Array<{ name: string; description?: string; source: string }> = [];

  for (const dir of getPresetDirs()) {
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir).filter((f) => f.endsWith('.yaml'));
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
          source: dir.includes('.agora') ? 'user' : 'builtin',
        });
      } catch {
        presets.push({ name, source: dir.includes('.agora') ? 'user' : 'builtin' });
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
