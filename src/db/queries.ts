import type Database from 'better-sqlite3';

// --- Agent queries ---

export interface AgentRow {
  id: string;
  name: string;
  model: string;
  personality_json: string;
  health: number;
  hunger: number;
  energy: number;
  location_id: string;
  reputation: number;
  is_alive: number;
  is_eliminated: number;
  is_chieftain: number;
  is_banished: number;
  cause_of_removal: string | null;
  removed_at_tick: number | null;
  removed_at_epoch: number | null;
  introduced_at_tick: number;
}

export function createAgent(db: Database.Database, agent: {
  id: string; name: string; model?: string; personalityJson: string;
  locationId: string; health?: number; hunger?: number; energy?: number;
}): void {
  db.prepare(
    `INSERT INTO agents (id, name, model, personality_json, location_id, health, hunger, energy)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    agent.id, agent.name, agent.model ?? 'claude-sonnet-4-20250514',
    agent.personalityJson, agent.locationId,
    agent.health ?? 100, agent.hunger ?? 0, agent.energy ?? 100
  );
}

export function getAgent(db: Database.Database, agentId: string): AgentRow | undefined {
  return db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as AgentRow | undefined;
}

export function getAgentByName(db: Database.Database, name: string): AgentRow | undefined {
  return db.prepare('SELECT * FROM agents WHERE name = ?').get(name) as AgentRow | undefined;
}

export function getAllAgents(db: Database.Database): AgentRow[] {
  return db.prepare('SELECT * FROM agents').all() as AgentRow[];
}

export function getLivingAgents(db: Database.Database): AgentRow[] {
  return db.prepare('SELECT * FROM agents WHERE is_alive = 1 AND is_eliminated = 0 AND is_banished = 0').all() as AgentRow[];
}

export function setChieftain(db: Database.Database, agentId: string, value: boolean): void {
  db.prepare('UPDATE agents SET is_chieftain = ? WHERE id = ?').run(value ? 1 : 0, agentId);
}

export function getChieftain(db: Database.Database): AgentRow | undefined {
  return db.prepare('SELECT * FROM agents WHERE is_chieftain = 1 AND is_alive = 1 AND is_banished = 0').get() as AgentRow | undefined;
}

export function banishAgent(db: Database.Database, agentId: string, tick: number, epoch: number): void {
  db.prepare(
    'UPDATE agents SET is_banished = 1, cause_of_removal = ?, removed_at_tick = ?, removed_at_epoch = ? WHERE id = ?'
  ).run('banished', tick, epoch, agentId);
}

export function updateAgentStats(db: Database.Database, agentId: string, stats: {
  health?: number; hunger?: number; energy?: number; location_id?: string; reputation?: number;
}): void {
  const sets: string[] = [];
  const values: (number | string)[] = [];
  if (stats.health !== undefined) { sets.push('health = ?'); values.push(stats.health); }
  if (stats.hunger !== undefined) { sets.push('hunger = ?'); values.push(stats.hunger); }
  if (stats.energy !== undefined) { sets.push('energy = ?'); values.push(stats.energy); }
  if (stats.location_id !== undefined) { sets.push('location_id = ?'); values.push(stats.location_id); }
  if (stats.reputation !== undefined) { sets.push('reputation = ?'); values.push(stats.reputation); }
  if (sets.length === 0) return;
  values.push(agentId);
  db.prepare(`UPDATE agents SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function markAgentDead(db: Database.Database, agentId: string, cause: string, tick: number, epoch: number): void {
  db.prepare(
    'UPDATE agents SET is_alive = 0, cause_of_removal = ?, removed_at_tick = ?, removed_at_epoch = ? WHERE id = ?'
  ).run(cause, tick, epoch, agentId);
}

// --- Location queries ---

export interface LocationRow {
  id: string;
  name: string;
  description: string;
  danger_level: number;
  connected_to_json: string;
}

export function createLocation(db: Database.Database, loc: {
  id: string; name: string; description: string; dangerLevel: number; connectedTo: string[];
}): void {
  db.prepare(
    'INSERT OR IGNORE INTO locations (id, name, description, danger_level, connected_to_json) VALUES (?, ?, ?, ?, ?)'
  ).run(loc.id, loc.name, loc.description, loc.dangerLevel, JSON.stringify(loc.connectedTo));
}

export function getLocation(db: Database.Database, locationId: string): LocationRow | undefined {
  return db.prepare('SELECT * FROM locations WHERE id = ?').get(locationId) as LocationRow | undefined;
}

export function getAllLocations(db: Database.Database): LocationRow[] {
  return db.prepare('SELECT * FROM locations').all() as LocationRow[];
}

// --- Resource queries ---

export interface ResourceRow {
  id: string;
  location_id: string;
  type: string;
  quantity: number;
  max_quantity: number;
  gather_difficulty: number;
  regen_rate: number;
}

export function createResource(db: Database.Database, res: {
  id: string; locationId: string; type: string; quantity: number; maxQuantity: number;
  gatherDifficulty?: number; regenRate?: number;
}): void {
  db.prepare(
    'INSERT OR IGNORE INTO resources (id, location_id, type, quantity, max_quantity, gather_difficulty, regen_rate) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(res.id, res.locationId, res.type, res.quantity, res.maxQuantity, res.gatherDifficulty ?? 0.3, res.regenRate ?? 1.0);
}

export function getResourcesAtLocation(db: Database.Database, locationId: string): ResourceRow[] {
  return db.prepare('SELECT * FROM resources WHERE location_id = ?').all(locationId) as ResourceRow[];
}

export function updateResourceQuantity(db: Database.Database, resourceId: string, quantity: number): void {
  db.prepare('UPDATE resources SET quantity = ? WHERE id = ?').run(Math.max(0, quantity), resourceId);
}

export function getAllResources(db: Database.Database): ResourceRow[] {
  return db.prepare('SELECT * FROM resources').all() as ResourceRow[];
}

// --- Inventory queries ---

export interface InventoryRow {
  id: string;
  agent_id: string;
  item_name: string;
  item_type: string;
  quantity: number;
  properties_json: string | null;
}

export function addInventoryItem(db: Database.Database, item: {
  id: string; agentId: string; itemName: string; itemType: string;
  quantity?: number; propertiesJson?: string;
}): void {
  db.prepare(
    'INSERT INTO inventory (id, agent_id, item_name, item_type, quantity, properties_json) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(item.id, item.agentId, item.itemName, item.itemType, item.quantity ?? 1, item.propertiesJson ?? null);
}

export function getAgentInventory(db: Database.Database, agentId: string): InventoryRow[] {
  return db.prepare('SELECT * FROM inventory WHERE agent_id = ?').all(agentId) as InventoryRow[];
}

export function removeInventoryItem(db: Database.Database, itemId: string): void {
  db.prepare('DELETE FROM inventory WHERE id = ?').run(itemId);
}

export function updateInventoryQuantity(db: Database.Database, itemId: string, quantity: number): void {
  if (quantity <= 0) {
    removeInventoryItem(db, itemId);
  } else {
    db.prepare('UPDATE inventory SET quantity = ? WHERE id = ?').run(quantity, itemId);
  }
}

export function transferInventoryItem(db: Database.Database, itemId: string, newAgentId: string): void {
  db.prepare('UPDATE inventory SET agent_id = ? WHERE id = ?').run(newAgentId, itemId);
}

export function scatterInventoryAtLocation(db: Database.Database, agentId: string, locationId: string): void {
  // For death/elimination: move items to a "location" pseudo-agent
  const items = getAgentInventory(db, agentId);
  for (const item of items) {
    // Remove from agent - in a real implementation we'd create ground items
    removeInventoryItem(db, item.id);
    // Re-add as a location item (agent_id = location_id as a convention)
    addInventoryItem(db, {
      id: `ground_${item.id}`,
      agentId: `ground_${locationId}`,
      itemName: item.item_name,
      itemType: item.item_type,
      quantity: item.quantity,
      propertiesJson: item.properties_json ?? undefined,
    });
  }
}

// --- Event log queries ---

export interface EventLogRow {
  id: number;
  tick: number;
  epoch: number;
  event_type: string;
  agent_id: string | null;
  target_agent_id: string | null;
  location_id: string | null;
  data_json: string;
  created_at: string;
}

export function appendEvent(db: Database.Database, event: {
  tick: number; epoch: number; eventType: string;
  agentId?: string; targetAgentId?: string; locationId?: string;
  dataJson: string;
}): void {
  db.prepare(
    'INSERT INTO event_log (tick, epoch, event_type, agent_id, target_agent_id, location_id, data_json) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(event.tick, event.epoch, event.eventType, event.agentId ?? null, event.targetAgentId ?? null, event.locationId ?? null, event.dataJson);
}

export function getEventsByTickRange(db: Database.Database, startTick: number, endTick: number): EventLogRow[] {
  return db.prepare('SELECT * FROM event_log WHERE tick >= ? AND tick <= ? ORDER BY id').all(startTick, endTick) as EventLogRow[];
}

export function getEventsByAgent(db: Database.Database, agentId: string): EventLogRow[] {
  return db.prepare('SELECT * FROM event_log WHERE agent_id = ? ORDER BY id').all(agentId) as EventLogRow[];
}

export function getEventCount(db: Database.Database): number {
  const row = db.prepare('SELECT COUNT(*) as count FROM event_log').get() as { count: number };
  return row.count;
}

// --- Simulation queries ---

export interface SimulationRow {
  id: number;
  current_tick: number;
  current_epoch: number;
  phase: string;
  config_json: string;
  seed: number;
  rng_state: string;
  status: string;
  total_cost: number;
  started_at: string;
  last_tick_at: string | null;
}

export function getSimulation(db: Database.Database): SimulationRow {
  return db.prepare('SELECT * FROM simulation WHERE id = 1').get() as SimulationRow;
}

export function updateSimulation(db: Database.Database, updates: {
  current_tick?: number; current_epoch?: number; phase?: string;
  rng_state?: string; status?: string; total_cost?: number;
  last_tick_at?: string; config_json?: string;
}): void {
  const sets: string[] = [];
  const values: (number | string)[] = [];
  for (const [key, val] of Object.entries(updates)) {
    if (val !== undefined) {
      sets.push(`${key} = ?`);
      values.push(val);
    }
  }
  if (sets.length === 0) return;
  db.prepare(`UPDATE simulation SET ${sets.join(', ')} WHERE id = 1`).run(...values);
}

// --- Memory queries ---

export interface MemoryShortTermRow {
  id: number;
  agent_id: string;
  tick: number;
  epoch: number;
  type: string;
  content: string;
  involved_agents_json: string | null;
  importance: number;
}

export function appendShortTermMemory(db: Database.Database, entry: {
  agentId: string; tick: number; epoch: number; type: string;
  content: string; involvedAgents?: string[]; importance?: number;
}): void {
  db.prepare(
    'INSERT INTO memory_short_term (agent_id, tick, epoch, type, content, involved_agents_json, importance) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(entry.agentId, entry.tick, entry.epoch, entry.type, entry.content,
    entry.involvedAgents ? JSON.stringify(entry.involvedAgents) : null,
    entry.importance ?? 0.5);
}

export function getShortTermMemory(db: Database.Database, agentId: string, limit: number = 50): MemoryShortTermRow[] {
  return db.prepare(
    'SELECT * FROM memory_short_term WHERE agent_id = ? ORDER BY id DESC LIMIT ?'
  ).all(agentId, limit) as MemoryShortTermRow[];
}

export function trimShortTermMemory(db: Database.Database, agentId: string, keepCount: number = 50): void {
  db.prepare(
    `DELETE FROM memory_short_term WHERE agent_id = ? AND id NOT IN (
      SELECT id FROM memory_short_term WHERE agent_id = ? ORDER BY id DESC LIMIT ?
    )`
  ).run(agentId, agentId, keepCount);
}

export interface MemoryLongTermRow {
  agent_id: string;
  summary: string;
  last_updated_tick: number;
}

export function getLongTermMemory(db: Database.Database, agentId: string): MemoryLongTermRow | undefined {
  return db.prepare('SELECT * FROM memory_long_term WHERE agent_id = ?').get(agentId) as MemoryLongTermRow | undefined;
}

export function upsertLongTermMemory(db: Database.Database, agentId: string, summary: string, tick: number): void {
  db.prepare(
    `INSERT INTO memory_long_term (agent_id, summary, last_updated_tick) VALUES (?, ?, ?)
     ON CONFLICT(agent_id) DO UPDATE SET summary = ?, last_updated_tick = ?`
  ).run(agentId, summary, tick, summary, tick);
}

// --- Relationship queries ---

export function upsertRelationship(db: Database.Database, agentA: string, agentB: string, sentiment: number, tick: number): void {
  db.prepare(
    `INSERT INTO relationships (agent_a, agent_b, sentiment, last_interaction_tick) VALUES (?, ?, ?, ?)
     ON CONFLICT(agent_a, agent_b) DO UPDATE SET sentiment = ?, last_interaction_tick = ?`
  ).run(agentA, agentB, sentiment, tick, sentiment, tick);
}

export function getRelationship(db: Database.Database, agentA: string, agentB: string): { sentiment: number } | undefined {
  return db.prepare('SELECT sentiment FROM relationships WHERE agent_a = ? AND agent_b = ?').get(agentA, agentB) as { sentiment: number } | undefined;
}

// --- Relationship helpers ---

export function adjustRelationship(db: Database.Database, agentA: string, agentB: string, delta: number, tick: number): number {
  const existing = getRelationship(db, agentA, agentB);
  const current = existing?.sentiment ?? 0;
  const newSentiment = Math.max(-100, Math.min(100, current + delta));
  upsertRelationship(db, agentA, agentB, newSentiment, tick);
  return newSentiment;
}

// --- Alliance queries ---

export interface AllianceRow {
  id: string;
  name: string;
  members_json: string;
  formed_at_tick: number;
  is_active: number;
}

export function createAlliance(db: Database.Database, id: string, name: string, members: string[], tick: number): void {
  db.prepare(
    'INSERT INTO alliances (id, name, members_json, formed_at_tick, is_active) VALUES (?, ?, ?, ?, 1)'
  ).run(id, name, JSON.stringify(members), tick);
}

export function getAlliance(db: Database.Database, id: string): AllianceRow | undefined {
  return db.prepare('SELECT * FROM alliances WHERE id = ?').get(id) as AllianceRow | undefined;
}

export function updateAllianceMembers(db: Database.Database, id: string, members: string[]): void {
  db.prepare('UPDATE alliances SET members_json = ? WHERE id = ?').run(JSON.stringify(members), id);
}

export function getAgentAlliances(db: Database.Database, agentId: string): AllianceRow[] {
  return (db.prepare('SELECT * FROM alliances WHERE is_active = 1').all() as AllianceRow[])
    .filter(a => (JSON.parse(a.members_json) as string[]).includes(agentId));
}

// --- Council motion queries ---

export interface CouncilMotionRow {
  id: number;
  epoch: number;
  motion_type: string;
  motion_text: string;
  proposed_by: string;
  seconded_by: string | null;
  target_agent_id: string | null;
  status: string;
  ayes: number;
  nays: number;
  abstentions: number;
  created_at_tick: number;
}

export function createMotion(db: Database.Database, motion: {
  epoch: number; motionType: string; motionText: string; proposedBy: string;
  targetAgentId?: string; tick: number;
}): number {
  const result = db.prepare(
    'INSERT INTO council_motions (epoch, motion_type, motion_text, proposed_by, target_agent_id, status, created_at_tick) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(motion.epoch, motion.motionType, motion.motionText, motion.proposedBy, motion.targetAgentId ?? null, 'proposed', motion.tick);
  return result.lastInsertRowid as number;
}

export function secondMotion(db: Database.Database, motionId: number, secondedBy: string): void {
  db.prepare('UPDATE council_motions SET seconded_by = ?, status = ? WHERE id = ?').run(secondedBy, 'seconded', motionId);
}

export function getMotionsByEpoch(db: Database.Database, epoch: number): CouncilMotionRow[] {
  return db.prepare('SELECT * FROM council_motions WHERE epoch = ? ORDER BY id').all(epoch) as CouncilMotionRow[];
}

export function getMotion(db: Database.Database, motionId: number): CouncilMotionRow | undefined {
  return db.prepare('SELECT * FROM council_motions WHERE id = ?').get(motionId) as CouncilMotionRow | undefined;
}

export function updateMotionStatus(db: Database.Database, motionId: number, status: string): void {
  db.prepare('UPDATE council_motions SET status = ? WHERE id = ?').run(status, motionId);
}

export function updateMotionTally(db: Database.Database, motionId: number, ayes: number, nays: number, abstentions: number): void {
  db.prepare('UPDATE council_motions SET ayes = ?, nays = ?, abstentions = ? WHERE id = ?').run(ayes, nays, abstentions, motionId);
}

// --- Council vote queries ---

export interface CouncilVoteRow {
  id: number;
  motion_id: number;
  epoch: number;
  voter_agent_id: string;
  vote: string;
  tick: number;
}

export function recordCouncilVote(db: Database.Database, motionId: number, epoch: number, voterId: string, vote: string, tick: number): void {
  // Replace existing vote if any
  db.prepare('DELETE FROM council_votes WHERE motion_id = ? AND voter_agent_id = ?').run(motionId, voterId);
  db.prepare(
    'INSERT INTO council_votes (motion_id, epoch, voter_agent_id, vote, tick) VALUES (?, ?, ?, ?, ?)'
  ).run(motionId, epoch, voterId, vote, tick);
}

export function getVotesForMotion(db: Database.Database, motionId: number): CouncilVoteRow[] {
  return db.prepare('SELECT * FROM council_votes WHERE motion_id = ?').all(motionId) as CouncilVoteRow[];
}

// --- Journal queries ---

export interface JournalRow {
  id: number;
  agent_id: string;
  epoch: number;
  tick: number;
  entry: string;
  created_at: string;
}

export function addJournalEntry(db: Database.Database, agentId: string, epoch: number, tick: number, entry: string): void {
  db.prepare(
    'INSERT INTO journal (agent_id, epoch, tick, entry) VALUES (?, ?, ?, ?)'
  ).run(agentId, epoch, tick, entry);
}

export function getJournalEntries(db: Database.Database, agentId: string, limit = 20): JournalRow[] {
  return db.prepare(
    'SELECT * FROM journal WHERE agent_id = ? ORDER BY epoch DESC LIMIT ?'
  ).all(agentId, limit) as JournalRow[];
}

export function getLatestJournalEpoch(db: Database.Database, agentId: string): number | null {
  const row = db.prepare(
    'SELECT MAX(epoch) as max_epoch FROM journal WHERE agent_id = ?'
  ).get(agentId) as { max_epoch: number | null } | undefined;
  return row?.max_epoch ?? null;
}

export function getAllJournalEntries(db: Database.Database, limit = 50): JournalRow[] {
  return db.prepare(
    'SELECT * FROM journal ORDER BY epoch DESC, tick DESC LIMIT ?'
  ).all(limit) as JournalRow[];
}

// --- Location structure queries ---

export interface LocationStructureRow {
  id: string;
  location_id: string;
  structure_type: string;
  built_by_agent_id: string | null;
  built_at_tick: number | null;
  durability: number;
  properties_json: string | null;
}

export function createLocationStructure(db: Database.Database, structure: {
  id: string; locationId: string; structureType: string;
  builtByAgentId?: string; builtAtTick?: number; propertiesJson?: string;
}): void {
  db.prepare(
    'INSERT OR REPLACE INTO location_structures (id, location_id, structure_type, built_by_agent_id, built_at_tick, properties_json) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(structure.id, structure.locationId, structure.structureType,
    structure.builtByAgentId ?? null, structure.builtAtTick ?? null, structure.propertiesJson ?? null);
}

export function getStructuresAtLocation(db: Database.Database, locationId: string): LocationStructureRow[] {
  return db.prepare('SELECT * FROM location_structures WHERE location_id = ?').all(locationId) as LocationStructureRow[];
}

export function removeLocationStructure(db: Database.Database, structureId: string): void {
  db.prepare('DELETE FROM location_structures WHERE id = ?').run(structureId);
}

// --- Location storage queries ---

export interface LocationStorageRow {
  id: string;
  location_id: string;
  item_name: string;
  item_type: string;
  quantity: number;
  properties_json: string | null;
}

export function addLocationStorageItem(db: Database.Database, item: {
  id: string; locationId: string; itemName: string; itemType: string;
  quantity?: number; propertiesJson?: string;
}): void {
  db.prepare(
    'INSERT INTO location_storage (id, location_id, item_name, item_type, quantity, properties_json) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(item.id, item.locationId, item.itemName, item.itemType, item.quantity ?? 1, item.propertiesJson ?? null);
}

export function getLocationStorage(db: Database.Database, locationId: string): LocationStorageRow[] {
  return db.prepare('SELECT * FROM location_storage WHERE location_id = ?').all(locationId) as LocationStorageRow[];
}

export function removeLocationStorageItem(db: Database.Database, itemId: string): void {
  db.prepare('DELETE FROM location_storage WHERE id = ?').run(itemId);
}

export function updateLocationStorageQuantity(db: Database.Database, itemId: string, quantity: number): void {
  if (quantity <= 0) {
    removeLocationStorageItem(db, itemId);
  } else {
    db.prepare('UPDATE location_storage SET quantity = ? WHERE id = ?').run(quantity, itemId);
  }
}

export function getTotalLocationStorageQuantity(db: Database.Database, locationId: string): number {
  const row = db.prepare('SELECT COALESCE(SUM(quantity), 0) as total FROM location_storage WHERE location_id = ?').get(locationId) as { total: number };
  return row.total;
}

// --- Epoch recap queries ---

export interface EpochRecapRow {
  epoch: number;
  recap_text: string;
  created_at: string;
}

export function upsertEpochRecap(db: Database.Database, epoch: number, recapText: string): void {
  db.prepare(
    'INSERT OR IGNORE INTO epoch_recaps (epoch, recap_text) VALUES (?, ?)'
  ).run(epoch, recapText);
}

export function getEpochRecap(db: Database.Database, epoch: number): EpochRecapRow | undefined {
  return db.prepare('SELECT * FROM epoch_recaps WHERE epoch = ?').get(epoch) as EpochRecapRow | undefined;
}
