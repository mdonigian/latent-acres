import Database from 'better-sqlite3';
import { SeededRNG } from '../rng.js';

export function initDatabase(dbPath: string, config?: { seed?: number; configJson?: string }): Database.Database {
  const db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT 'claude-sonnet-4-20250514',
      personality_json TEXT NOT NULL,
      health INTEGER DEFAULT 100,
      hunger INTEGER DEFAULT 0,
      energy INTEGER DEFAULT 100,
      location_id TEXT NOT NULL,
      reputation INTEGER DEFAULT 50,
      is_alive INTEGER DEFAULT 1,
      is_eliminated INTEGER DEFAULT 0,
      is_chieftain INTEGER DEFAULT 0,
      is_banished INTEGER DEFAULT 0,
      cause_of_removal TEXT,
      removed_at_tick INTEGER,
      removed_at_epoch INTEGER,
      introduced_at_tick INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS locations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      danger_level REAL DEFAULT 0,
      connected_to_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS resources (
      id TEXT PRIMARY KEY,
      location_id TEXT NOT NULL,
      type TEXT NOT NULL,
      quantity REAL NOT NULL,
      max_quantity REAL NOT NULL DEFAULT 10,
      gather_difficulty REAL DEFAULT 0.3,
      regen_rate REAL DEFAULT 1.0,
      FOREIGN KEY (location_id) REFERENCES locations(id)
    );

    CREATE TABLE IF NOT EXISTS inventory (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      item_name TEXT NOT NULL,
      item_type TEXT NOT NULL,
      quantity INTEGER DEFAULT 1,
      properties_json TEXT
    );

    CREATE TABLE IF NOT EXISTS alliances (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      members_json TEXT NOT NULL,
      formed_at_tick INTEGER,
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS memory_short_term (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      tick INTEGER NOT NULL,
      epoch INTEGER NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      involved_agents_json TEXT,
      importance REAL DEFAULT 0.5,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );

    CREATE TABLE IF NOT EXISTS memory_long_term (
      agent_id TEXT PRIMARY KEY,
      summary TEXT NOT NULL,
      last_updated_tick INTEGER,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );

    CREATE TABLE IF NOT EXISTS relationships (
      agent_a TEXT NOT NULL,
      agent_b TEXT NOT NULL,
      sentiment INTEGER DEFAULT 0,
      last_interaction_tick INTEGER,
      PRIMARY KEY (agent_a, agent_b),
      FOREIGN KEY (agent_a) REFERENCES agents(id),
      FOREIGN KEY (agent_b) REFERENCES agents(id)
    );

    CREATE TABLE IF NOT EXISTS event_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tick INTEGER NOT NULL,
      epoch INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      agent_id TEXT,
      target_agent_id TEXT,
      location_id TEXT,
      data_json TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS world_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tick INTEGER NOT NULL,
      event_name TEXT NOT NULL,
      description TEXT NOT NULL,
      effects_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS council_motions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      epoch INTEGER NOT NULL,
      motion_type TEXT NOT NULL,
      motion_text TEXT NOT NULL,
      proposed_by TEXT NOT NULL,
      seconded_by TEXT,
      target_agent_id TEXT,
      status TEXT DEFAULT 'proposed',
      ayes INTEGER DEFAULT 0,
      nays INTEGER DEFAULT 0,
      abstentions INTEGER DEFAULT 0,
      created_at_tick INTEGER NOT NULL,
      FOREIGN KEY (proposed_by) REFERENCES agents(id)
    );

    CREATE TABLE IF NOT EXISTS council_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      motion_id INTEGER NOT NULL,
      epoch INTEGER NOT NULL,
      voter_agent_id TEXT NOT NULL,
      vote TEXT NOT NULL,
      tick INTEGER NOT NULL,
      FOREIGN KEY (motion_id) REFERENCES council_motions(id),
      FOREIGN KEY (voter_agent_id) REFERENCES agents(id)
    );

    CREATE TABLE IF NOT EXISTS simulation (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      current_tick INTEGER DEFAULT 0,
      current_epoch INTEGER DEFAULT 0,
      phase TEXT DEFAULT 'tick',
      config_json TEXT NOT NULL,
      seed INTEGER NOT NULL,
      rng_state TEXT NOT NULL,
      status TEXT DEFAULT 'running',
      total_cost REAL DEFAULT 0,
      started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_tick_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS journal (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      epoch INTEGER NOT NULL,
      tick INTEGER NOT NULL,
      entry TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );

    CREATE TABLE IF NOT EXISTS epoch_recaps (
      epoch INTEGER PRIMARY KEY,
      recap_text TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS location_structures (
      id TEXT PRIMARY KEY,
      location_id TEXT NOT NULL,
      structure_type TEXT NOT NULL,
      built_by_agent_id TEXT,
      built_at_tick INTEGER,
      durability INTEGER DEFAULT 100,
      properties_json TEXT,
      FOREIGN KEY (location_id) REFERENCES locations(id)
    );

    CREATE TABLE IF NOT EXISTS location_storage (
      id TEXT PRIMARY KEY,
      location_id TEXT NOT NULL,
      item_name TEXT NOT NULL,
      item_type TEXT NOT NULL,
      quantity INTEGER DEFAULT 1,
      properties_json TEXT,
      FOREIGN KEY (location_id) REFERENCES locations(id)
    );

    CREATE INDEX IF NOT EXISTS idx_events_tick ON event_log(tick);
    CREATE INDEX IF NOT EXISTS idx_events_agent ON event_log(agent_id);
    CREATE INDEX IF NOT EXISTS idx_memory_agent_tick ON memory_short_term(agent_id, tick);
    CREATE INDEX IF NOT EXISTS idx_journal_agent ON journal(agent_id, epoch);
    CREATE INDEX IF NOT EXISTS idx_loc_structures_location ON location_structures(location_id);
    CREATE INDEX IF NOT EXISTS idx_loc_storage_location ON location_storage(location_id);
  `);

  // Insert simulation singleton row if not exists
  const seed = config?.seed ?? 1;
  const rng = new SeededRNG(seed);
  const configJson = config?.configJson ?? '{}';

  const existing = db.prepare('SELECT id FROM simulation WHERE id = 1').get();
  if (!existing) {
    db.prepare(
      'INSERT INTO simulation (id, current_tick, current_epoch, phase, config_json, seed, rng_state, status, total_cost) VALUES (1, 0, 0, ?, ?, ?, ?, ?, 0)'
    ).run('tick', configJson, seed, rng.getState(), 'running');
  }

  return db;
}
