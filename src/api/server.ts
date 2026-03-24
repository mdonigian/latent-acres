import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import type Database from 'better-sqlite3';
import type { SimulationConfig } from '../config.js';
import type { ModelAdapter } from '../agents/orchestrator.js';
import { executeTick } from '../engine/tick-loop.js';
import { getLivingAgents, getSimulation, updateSimulation } from '../db/queries.js';
import { createRoutes } from './routes.js';
import { log } from '../utils/logger.js';

export interface ServerInstance {
  app: ReturnType<typeof express>;
  httpServer: ReturnType<typeof createServer>;
  wss: WebSocketServer;
  broadcast: (type: string, data: unknown) => void;
  runner: SimulationRunner;
  close: () => void;
}

export class SimulationRunner {
  private running = false;
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private broadcast: ((type: string, data: unknown) => void) | null = null;

  constructor(
    private db: Database.Database,
    private config: SimulationConfig,
    private adapter: ModelAdapter | null,
    private dryRun: boolean,
  ) {}

  setBroadcast(fn: (type: string, data: unknown) => void) {
    this.broadcast = fn;
  }

  isRunning() { return this.running; }

  getTickDelaySec() { return this.config.tickDelayMs / 1000; }

  setTickDelayMs(ms: number) {
    this.config = { ...this.config, tickDelayMs: ms };
    log('info', `Tick delay set to ${ms / 1000}s`);
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    updateSimulation(this.db, { status: 'running' });
    this.broadcast?.('simulation_status', { status: 'running' });
    log('info', 'Simulation started');
    this.scheduleNextTick();
  }

  pause(): void {
    if (!this.running) return;
    this.running = false;
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
    updateSimulation(this.db, { status: 'paused' });
    this.broadcast?.('simulation_status', { status: 'paused' });
    log('info', 'Simulation paused');
  }

  private scheduleNextTick() {
    if (!this.running) return;

    this.tickTimer = setTimeout(async () => {
      if (!this.running) return;

      const living = getLivingAgents(this.db);
      if (living.length === 0) {
        log('warn', 'All agents have died. Simulation paused.');
        this.pause();
        return;
      }

      try {
        const result = await executeTick(this.db, this.config, this.adapter, this.dryRun);

        if (this.broadcast) {
          this.broadcast('tick_complete', result);
          for (const d of result.deaths) {
            this.broadcast('agent_death', d);
          }
          for (const e of result.events) {
            this.broadcast('world_event', e);
          }
        }
      } catch (err) {
        log('error', `Tick error: ${(err as Error).message}`);
      }

      this.scheduleNextTick();
    }, this.config.tickDelayMs);
  }
}

export function createApiServer(
  db: Database.Database,
  port: number,
  config: SimulationConfig,
  adapter: ModelAdapter | null,
  dryRun: boolean,
): ServerInstance {
  const app = express();
  app.use(express.json());

  const runner = new SimulationRunner(db, config, adapter, dryRun);

  // Ensure DB status reflects that we're starting paused
  updateSimulation(db, { status: 'paused' });

  // Mount API routes
  app.use('/api', createRoutes(db));

  // Simulation control endpoints
  app.post('/api/sim/start', (_req, res) => {
    runner.start();
    res.json({ status: 'running' });
  });

  app.post('/api/sim/pause', (_req, res) => {
    runner.pause();
    res.json({ status: 'paused' });
  });

  app.get('/api/sim/status', (_req, res) => {
    res.json({ running: runner.isRunning(), tickDelaySec: runner.getTickDelaySec() });
  });

  app.post('/api/sim/tick-delay', (req, res) => {
    const sec = Number(req.body.seconds);
    if (!sec || sec < 1 || sec > 600) {
      res.status(400).json({ error: 'seconds must be between 1 and 600' });
      return;
    }
    runner.setTickDelayMs(sec * 1000);
    res.json({ tickDelaySec: sec });
  });

  const httpServer = createServer(app);

  // WebSocket
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  wss.on('connection', (ws: WebSocket) => {
    ws.on('error', () => {});
  });

  function broadcast(type: string, data: unknown) {
    const message = JSON.stringify({ type, data });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  runner.setBroadcast(broadcast);

  function close() {
    runner.pause();
    wss.close();
    httpServer.close();
  }

  return { app, httpServer, wss, broadcast, runner, close };
}
