import { Router, type Request, type Response } from 'express';
import type Database from 'better-sqlite3';
import {
  getSimulation, getAllAgents, getAgent, getLivingAgents,
  getAgentInventory, getShortTermMemory,
  getAllLocations, getResourcesAtLocation,
  getMotionsByEpoch, getVotesForMotion,
  getJournalEntries, getAllJournalEntries,
  type AgentRow, type EventLogRow,
} from '../db/queries.js';

export function createRoutes(db: Database.Database): Router {
  const router = Router();

  // --- Simulation State ---

  router.get('/status', (_req: Request, res: Response) => {
    const sim = getSimulation(db);
    const living = getLivingAgents(db);
    const all = getAllAgents(db);
    res.json({
      tick: sim.current_tick,
      epoch: sim.current_epoch,
      phase: sim.phase,
      status: sim.status,
      livingAgents: living.length,
      totalAgents: all.length,
      cost: sim.total_cost,
    });
  });

  router.get('/config', (_req: Request, res: Response) => {
    const sim = getSimulation(db);
    res.json(JSON.parse(sim.config_json));
  });

  // --- Agents ---

  router.get('/agents', (_req: Request, res: Response) => {
    const agents = getAllAgents(db);
    res.json(agents.map(formatAgent));
  });

  router.get('/agents/:id', (req: Request, res: Response) => {
    const agent = getAgent(db, req.params.id);
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }

    const inventory = getAgentInventory(db, agent.id);
    const shortTerm = getShortTermMemory(db, agent.id, 20);
    let personality = {};
    try { personality = JSON.parse(agent.personality_json); } catch {}

    const relationships = db.prepare(
      'SELECT agent_b AS other, sentiment FROM relationships WHERE agent_a = ? UNION SELECT agent_a AS other, sentiment FROM relationships WHERE agent_b = ?'
    ).all(agent.id, agent.id) as { other: string; sentiment: number }[];

    const journal = getJournalEntries(db, agent.id, 10);

    res.json({
      ...formatAgent(agent),
      inventory: inventory.map(i => ({ name: i.item_name, type: i.item_type, quantity: i.quantity })),
      personality,
      relationships,
      shortTermMemory: shortTerm.map(m => ({ tick: m.tick, type: m.type, content: m.content })),
      journal: journal.map(j => ({ epoch: j.epoch, tick: j.tick, entry: j.entry })),
    });
  });

  router.get('/agents/:id/journal', (req: Request, res: Response) => {
    const agent = getAgent(db, req.params.id);
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
    const journal = getJournalEntries(db, agent.id, 50);
    res.json(journal.map(j => ({ epoch: j.epoch, tick: j.tick, entry: j.entry, createdAt: j.created_at })));
  });

  router.get('/journal', (_req: Request, res: Response) => {
    const entries = getAllJournalEntries(db, 100);
    const agents = getAllAgents(db);
    const nameMap = new Map(agents.map(a => [a.id, a.name]));
    res.json(entries.map(j => ({
      agentId: j.agent_id,
      agentName: nameMap.get(j.agent_id) ?? j.agent_id,
      epoch: j.epoch,
      tick: j.tick,
      entry: j.entry,
    })));
  });

  router.get('/agents/:id/memory', (req: Request, res: Response) => {
    const agent = getAgent(db, req.params.id);
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
    const memory = getShortTermMemory(db, agent.id, 50);
    res.json(memory.map(m => ({ tick: m.tick, epoch: m.epoch, type: m.type, content: m.content, importance: m.importance })));
  });

  router.get('/agents/:id/thoughts', (req: Request, res: Response) => {
    const agent = getAgent(db, req.params.id);
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
    const thoughts = db.prepare(
      "SELECT * FROM event_log WHERE agent_id = ? AND event_type = 'internal_monologue' ORDER BY id DESC LIMIT 50"
    ).all(agent.id) as EventLogRow[];
    res.json(thoughts.map(t => ({ tick: t.tick, epoch: t.epoch, data: JSON.parse(t.data_json) })));
  });

  // --- World ---

  router.get('/locations', (_req: Request, res: Response) => {
    const locations = getAllLocations(db);
    const agents = getAllAgents(db).filter(a => a.is_alive && !a.is_banished);
    res.json(locations.map(loc => {
      const resources = getResourcesAtLocation(db, loc.id);
      const presentAgents = agents.filter(a => a.location_id === loc.id);
      return {
        id: loc.id,
        name: loc.name,
        description: loc.description,
        dangerLevel: loc.danger_level,
        connectedTo: JSON.parse(loc.connected_to_json),
        resources: resources.map(r => ({
          type: r.type, quantity: r.quantity, maxQuantity: r.max_quantity,
          availability: r.quantity / r.max_quantity < 0.3 ? 'scarce' : r.quantity / r.max_quantity < 0.7 ? 'moderate' : 'abundant',
        })),
        agents: presentAgents.map(a => ({ id: a.id, name: a.name })),
      };
    }));
  });

  router.get('/map', (_req: Request, res: Response) => {
    const locations = getAllLocations(db);
    const nodes = locations.map(l => ({ id: l.id, name: l.name, dangerLevel: l.danger_level }));
    const edgeSet = new Set<string>();
    const edges: { from: string; to: string }[] = [];
    for (const loc of locations) {
      const connected: string[] = JSON.parse(loc.connected_to_json);
      for (const c of connected) {
        const key = [loc.id, c].sort().join(':');
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          edges.push({ from: loc.id, to: c });
        }
      }
    }
    res.json({ nodes, edges });
  });

  // --- Events ---

  router.get('/events', (req: Request, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
    const offset = parseInt(req.query.offset as string) || 0;

    let query = 'SELECT * FROM event_log WHERE 1=1';
    const params: (string | number)[] = [];

    if (req.query.tick) { query += ' AND tick = ?'; params.push(parseInt(req.query.tick as string)); }
    if (req.query.epoch) { query += ' AND epoch = ?'; params.push(parseInt(req.query.epoch as string)); }
    if (req.query.agent_id) { query += ' AND agent_id = ?'; params.push(req.query.agent_id as string); }
    if (req.query.event_type) { query += ' AND event_type = ?'; params.push(req.query.event_type as string); }

    query += ' ORDER BY id DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const events = db.prepare(query).all(...params) as EventLogRow[];
    res.json(events.map(e => ({
      id: e.id, tick: e.tick, epoch: e.epoch, eventType: e.event_type,
      agentId: e.agent_id, targetAgentId: e.target_agent_id, locationId: e.location_id,
      data: JSON.parse(e.data_json),
    })));
  });

  router.get('/events/world', (_req: Request, res: Response) => {
    const events = db.prepare('SELECT * FROM world_events ORDER BY id DESC LIMIT 100').all() as any[];
    res.json(events);
  });

  // --- Council ---

  router.get('/council/latest', (_req: Request, res: Response) => {
    const sim = getSimulation(db);
    const epoch = sim.current_epoch > 0 ? sim.current_epoch - 1 : 0;
    const motions = getMotionsByEpoch(db, epoch);
    res.json({ epoch, motions: motions.map(formatMotion) });
  });

  router.get('/council/:epoch', (req: Request, res: Response) => {
    const epoch = parseInt(req.params.epoch);
    const motions = getMotionsByEpoch(db, epoch);
    const events = db.prepare(
      "SELECT * FROM event_log WHERE epoch = ? AND event_type LIKE 'council%' ORDER BY id"
    ).all(epoch) as EventLogRow[];

    res.json({
      epoch,
      motions: motions.map(formatMotion),
      events: events.map(e => ({ tick: e.tick, type: e.event_type, data: JSON.parse(e.data_json) })),
    });
  });

  router.get('/council/:epoch/votes', (req: Request, res: Response) => {
    const epoch = parseInt(req.params.epoch);
    const motions = getMotionsByEpoch(db, epoch);
    const result = motions.map(m => ({
      motionId: m.id,
      motionText: m.motion_text,
      votes: getVotesForMotion(db, m.id).map(v => ({
        voter: v.voter_agent_id, vote: v.vote,
      })),
    }));
    res.json(result);
  });

  // --- Relationships ---

  router.get('/relationships', (_req: Request, res: Response) => {
    const rels = db.prepare('SELECT agent_a AS agentA, agent_b AS agentB, sentiment FROM relationships').all();
    res.json(rels);
  });

  router.get('/relationships/:agentId', (req: Request, res: Response) => {
    const rels = db.prepare(
      'SELECT agent_a AS agentA, agent_b AS agentB, sentiment FROM relationships WHERE agent_a = ? OR agent_b = ?'
    ).all(req.params.agentId, req.params.agentId);
    res.json(rels);
  });

  // --- Conversations ---

  router.get('/conversations', (req: Request, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const speeches = db.prepare(
      "SELECT id, tick, epoch, agent_id, data_json FROM event_log WHERE event_type = 'speech' ORDER BY tick DESC, id DESC LIMIT ?"
    ).all(limit) as EventLogRow[];

    const agents = getAllAgents(db);
    const nameMap = new Map(agents.map(a => [a.id, a.name]));

    res.json(speeches.map(s => {
      const data = JSON.parse(s.data_json);
      return {
        id: s.id,
        tick: s.tick,
        epoch: s.epoch,
        from: data.from ?? nameMap.get(s.agent_id) ?? s.agent_id,
        message: data.message,
        target: data.target ?? 'all',
        isWhisper: data.isWhisper ?? false,
        location: data.location_id,
      };
    }).reverse());
  });

  // --- Cost ---

  router.get('/cost', (_req: Request, res: Response) => {
    const sim = getSimulation(db);
    const costEvents = db.prepare(
      "SELECT tick, data_json FROM event_log WHERE event_type = 'tick_cost' ORDER BY tick"
    ).all() as { tick: number; data_json: string }[];
    res.json({
      totalCost: sim.total_cost,
      perTick: costEvents.map(e => ({ tick: e.tick, ...JSON.parse(e.data_json) })),
    });
  });

  // --- Export ---

  router.get('/export/transcript', (req: Request, res: Response) => {
    const fromTick = parseInt(req.query.from_tick as string) || 0;
    const toTick = parseInt(req.query.to_tick as string) || 999999;

    const events = db.prepare(
      'SELECT * FROM event_log WHERE tick >= ? AND tick <= ? ORDER BY id'
    ).all(fromTick, toTick) as EventLogRow[];

    let md = `# Latent Acres Simulation Transcript\n\n`;
    let currentTick = -1;
    for (const e of events) {
      if (e.tick !== currentTick) {
        currentTick = e.tick;
        md += `\n## Tick ${e.tick} (Epoch ${e.epoch})\n\n`;
      }
      const data = JSON.parse(e.data_json);
      md += `- **${e.event_type}**${e.agent_id ? ` (${e.agent_id})` : ''}: ${JSON.stringify(data)}\n`;
    }

    res.type('text/markdown').send(md);
  });

  return router;
}

function formatAgent(agent: AgentRow) {
  return {
    id: agent.id,
    name: agent.name,
    health: agent.health,
    hunger: agent.hunger,
    energy: agent.energy,
    location: agent.location_id,
    isAlive: !!agent.is_alive,
    isChieftain: !!agent.is_chieftain,
    isBanished: !!agent.is_banished,
  };
}

function formatMotion(m: any) {
  return {
    id: m.id,
    type: m.motion_type,
    text: m.motion_text,
    proposedBy: m.proposed_by,
    secondedBy: m.seconded_by,
    targetAgentId: m.target_agent_id,
    status: m.status,
    ayes: m.ayes,
    nays: m.nays,
    abstentions: m.abstentions,
  };
}
