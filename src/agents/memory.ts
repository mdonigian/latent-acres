import type Database from 'better-sqlite3';
import { appendShortTermMemory, getShortTermMemory, trimShortTermMemory, getJournalEntries } from '../db/queries.js';

export const SHORT_TERM_LIMIT = 50;

export interface MemoryEntry {
  tick: number;
  epoch: number;
  type: string;
  content: string;
  involvedAgents?: string[];
  importance?: number;
}

export function appendMemory(db: Database.Database, agentId: string, entry: MemoryEntry): void {
  appendShortTermMemory(db, {
    agentId,
    tick: entry.tick,
    epoch: entry.epoch,
    type: entry.type,
    content: entry.content,
    involvedAgents: entry.involvedAgents,
    importance: entry.importance,
  });
  trimShortTermMemory(db, agentId, SHORT_TERM_LIMIT);
}

export function getMemoryForPrompt(db: Database.Database, agentId: string): {
  shortTerm: { tick: number; type: string; content: string }[];
  journal: { epoch: number; entry: string }[];
} {
  const shortTerm = getShortTermMemory(db, agentId, SHORT_TERM_LIMIT)
    .reverse()
    .map(m => ({ tick: m.tick, type: m.type, content: m.content }));

  // Journal entries serve as persistent long-term memory
  const journal = getJournalEntries(db, agentId, 5)
    .map(j => ({ epoch: j.epoch, entry: j.entry }));

  return { shortTerm, journal };
}
