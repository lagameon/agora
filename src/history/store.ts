import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { RoundtableEvent } from '../roundtable/types.js';

const DB_DIR = join(process.env.HOME ?? '.', '.agora');
const DB_PATH = join(DB_DIR, 'agora.db');

let _db: Database | null = null;

function getDb(): Database {
  if (_db) return _db;

  if (!existsSync(DB_DIR)) {
    mkdirSync(DB_DIR, { recursive: true });
  }

  _db = new Database(DB_PATH);
  _db.run('PRAGMA journal_mode=WAL');
  _db.run('PRAGMA foreign_keys=ON');

  _db.run(`
    CREATE TABLE IF NOT EXISTS discussions (
      id TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      preset TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      duration_ms INTEGER,
      total_tokens INTEGER,
      synthesis TEXT
    )
  `);

  _db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discussion_id TEXT NOT NULL REFERENCES discussions(id),
      agent_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      round INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  return _db;
}

export interface DiscussionSummary {
  id: string;
  topic: string;
  preset: string | null;
  createdAt: string;
  durationMs: number | null;
  totalTokens: number | null;
  synthesis: string | null;
}

export interface DiscussionMessage {
  agentId: string;
  agentName: string;
  round: number;
  role: string;
  content: string;
  model: string | null;
}

/**
 * Collector that listens to roundtable events and persists to SQLite.
 */
export class DiscussionRecorder {
  private id: string;
  private db: Database;
  private insertMsg: ReturnType<Database['prepare']>;

  constructor(topic: string, preset?: string) {
    this.id = randomUUID().slice(0, 12);
    this.db = getDb();

    this.db.run(
      'INSERT INTO discussions (id, topic, preset) VALUES (?, ?, ?)',
      [this.id, topic, preset ?? null],
    );

    this.insertMsg = this.db.prepare(
      'INSERT INTO messages (discussion_id, agent_id, agent_name, round, role, content, model) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
  }

  get discussionId(): string {
    return this.id;
  }

  /** Process a single roundtable event */
  handleEvent(event: RoundtableEvent): void {
    switch (event.type) {
      case 'agent_done':
        this.insertMsg.run(
          this.id,
          event.agentId,
          event.agentName,
          event.round,
          'panelist',
          event.fullResponse,
          event.model,
        );
        break;

      case 'synthesis_done':
        this.db.run(
          'UPDATE discussions SET synthesis = ? WHERE id = ?',
          [event.answer, this.id],
        );
        break;

      case 'roundtable_done':
        this.db.run(
          'UPDATE discussions SET duration_ms = ?, total_tokens = ? WHERE id = ?',
          [event.stats.durationMs, event.stats.totalTokensEstimate, this.id],
        );
        break;
    }
  }
}

/**
 * List recent discussions.
 */
export function listDiscussions(limit = 20): DiscussionSummary[] {
  const db = getDb();
  const rows = db.query(
    'SELECT id, topic, preset, created_at as createdAt, duration_ms as durationMs, total_tokens as totalTokens, synthesis FROM discussions ORDER BY created_at DESC LIMIT ?',
  ).all(limit) as DiscussionSummary[];
  return rows;
}

/**
 * Get a specific discussion with all its messages.
 */
export function getDiscussion(id: string): { discussion: DiscussionSummary; messages: DiscussionMessage[] } | null {
  const db = getDb();
  const discussion = db.query(
    'SELECT id, topic, preset, created_at as createdAt, duration_ms as durationMs, total_tokens as totalTokens, synthesis FROM discussions WHERE id = ?',
  ).get(id) as DiscussionSummary | null;

  if (!discussion) return null;

  const messages = db.query(
    'SELECT agent_id as agentId, agent_name as agentName, round, role, content, model FROM messages WHERE discussion_id = ? ORDER BY id',
  ).all(id) as DiscussionMessage[];

  return { discussion, messages };
}
