import 'dotenv/config';
import { Command } from 'commander';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { dirname } from 'path';
import Database from 'better-sqlite3';
import { loadConfig, type SimulationConfig } from './config.js';
import { initDatabase } from './db/schema.js';
import { getSimulation, getLivingAgents, getAllAgents, getAgentByName, getAgentInventory, getShortTermMemory, updateSimulation } from './db/queries.js';
import { seedIslandToDatabase } from './world/island.js';
import { loadAllPersonalities } from './agents/personality.js';
import { createAgent, setChieftain } from './db/queries.js';
import { runSimulation } from './engine/tick-loop.js';
import { ClaudeAdapter } from './agents/model-adapter.js';
import { log } from './utils/logger.js';
import { createApiServer } from './api/server.js';

const program = new Command();

program
  .name('latent-acres')
  .description('Latent Acres - AI Survival Simulation')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize a new world database')
  .option('--seed <number>', 'RNG seed', '1')
  .option('--agents-dir <path>', 'Path to agents directory', './agents')
  .option('--db-path <path>', 'Database path', 'data/latent-acres.db')
  .option('--force', 'Delete existing database before initializing')
  .action((opts) => {
    const dbPath = opts.dbPath;
    if (existsSync(dbPath)) {
      if (opts.force) {
        unlinkSync(dbPath);
        // Also clean up WAL/SHM files if present
        try { unlinkSync(dbPath + '-wal'); } catch {}
        try { unlinkSync(dbPath + '-shm'); } catch {}
      } else {
        console.error(`Database already exists at ${dbPath}. Use --force to overwrite.`);
        process.exit(1);
      }
    }

    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const seed = parseInt(opts.seed, 10);
    const config = loadConfig({ seed, dbPath });

    const db = initDatabase(dbPath, { seed, configJson: JSON.stringify(config) });
    seedIslandToDatabase(db);

    // Load agents
    const personalities = loadAllPersonalities(opts.agentsDir);
    for (const p of personalities) {
      const agentId = p.name.toLowerCase().replace(/\s+/g, '_');
      createAgent(db, {
        id: agentId,
        name: p.name,
        model: p.model,
        personalityJson: JSON.stringify(p),
        locationId: p.startingLocation ?? 'the_beach',
      });
      if (p.isChieftain) {
        setChieftain(db, agentId, true);
      }
    }

    log('info', `World initialized at ${dbPath} with seed ${seed} and ${personalities.length} agents.`);
    db.close();
  });

program
  .command('run')
  .description('Run the simulation')
  .option('--tick-delay <ms>', 'Delay between ticks in ms', '1000')
  .option('--ticks <n>', 'Number of ticks to run')
  .option('--actions <n>', 'Actions per agent per tick', '6')
  .option('--dry-run', 'Use heuristic agents instead of API calls')
  .option('--db-path <path>', 'Database path', 'data/latent-acres.db')
  .option('--dashboard', 'Start the API/WebSocket server for the dashboard')
  .option('--port <number>', 'Dashboard server port', '3000')
  .action(async (opts) => {
    if (!opts.dryRun && !process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
      console.error('ANTHROPIC_API_KEY or OPENAI_API_KEY required to run the simulation.');
      console.error('Set them in .env or use --dry-run for testing without API calls.');
      process.exit(1);
    }

    if (!existsSync(opts.dbPath)) {
      console.error(`No database found at ${opts.dbPath}. Run 'init' first.`);
      process.exit(1);
    }

    const db = new Database(opts.dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    const sim = getSimulation(db);
    const config = loadConfig({
      ...JSON.parse(sim.config_json),
      tickDelayMs: parseInt(opts.tickDelay, 10),
      actionsPerTick: parseInt(opts.actions, 10),
    });

    // Per-agent model adapters are resolved in the orchestrator from each agent's model field
    const adapter = null;

    if (opts.dashboard) {
      // Dashboard mode: server-driven simulation, controllable via UI
      const port = parseInt(opts.port, 10);
      const server = createApiServer(db, port, config, adapter, opts.dryRun ?? false);
      server.httpServer.listen(port, () => {
        log('info', `Dashboard API running on http://localhost:${port}`);
        log('info', `Simulation ready at tick ${sim.current_tick}. Use the dashboard to start/pause.`);
      });

      // If --ticks provided, auto-start and run that many then pause
      // Otherwise wait for dashboard to start it
      if (opts.ticks) {
        // For backwards compat: run N ticks then pause
        await runSimulation(db, config, adapter, {
          ticks: parseInt(opts.ticks, 10),
          dryRun: opts.dryRun ?? false,
          broadcast: server.broadcast,
        });
        log('info', 'Ticks complete. Dashboard still running. Press Ctrl+C to exit.');
      }

      // Keep process alive
      await new Promise(() => {});
    } else {
      // CLI-only mode: run ticks and exit
      log('info', `Resuming simulation from tick ${sim.current_tick}`);

      await runSimulation(db, config, adapter, {
        ticks: opts.ticks ? parseInt(opts.ticks, 10) : undefined,
        dryRun: opts.dryRun ?? false,
      });

      db.close();
    }
  });

program
  .command('pause')
  .description('Pause the simulation')
  .option('--db-path <path>', 'Database path', 'data/latent-acres.db')
  .action((opts) => {
    if (!existsSync(opts.dbPath)) {
      console.error(`No database found at ${opts.dbPath}.`);
      process.exit(1);
    }
    const db = new Database(opts.dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    updateSimulation(db, { status: 'paused' });
    log('info', 'Simulation paused.');
    db.close();
  });

program
  .command('status')
  .description('Show simulation status')
  .option('--db-path <path>', 'Database path', 'data/latent-acres.db')
  .action((opts) => {
    if (!existsSync(opts.dbPath)) {
      console.error(`No database found at ${opts.dbPath}. Run 'init' first.`);
      process.exit(1);
    }
    const db = new Database(opts.dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    const sim = getSimulation(db);
    const living = getLivingAgents(db);
    const allAgents = getAllAgents(db);

    console.log(`Tick: ${sim.current_tick}`);
    console.log(`Epoch: ${sim.current_epoch}`);
    console.log(`Phase: ${sim.phase}`);
    console.log(`Status: ${sim.status}`);
    console.log(`Agents: ${living.length}/${allAgents.length} alive`);
    console.log(`Cost: $${sim.total_cost.toFixed(2)}`);
    db.close();
  });

program
  .command('inspect')
  .description('Inspect an agent')
  .requiredOption('--agent <name>', 'Agent name')
  .option('--db-path <path>', 'Database path', 'data/latent-acres.db')
  .action((opts) => {
    if (!existsSync(opts.dbPath)) {
      console.error(`No database found at ${opts.dbPath}.`);
      process.exit(1);
    }
    const db = new Database(opts.dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    const agent = getAgentByName(db, opts.agent);
    if (!agent) {
      console.error(`Agent "${opts.agent}" not found.`);
      db.close();
      process.exit(1);
    }

    const inventory = getAgentInventory(db, agent.id);
    const memory = getShortTermMemory(db, agent.id, 10);

    console.log(`Name: ${agent.name}`);
    console.log(`Health: ${agent.health}`);
    console.log(`Hunger: ${agent.hunger}`);
    console.log(`Energy: ${agent.energy}`);
    console.log(`Location: ${agent.location_id}`);
    console.log(`Alive: ${agent.is_alive ? 'Yes' : 'No'}`);
    console.log(`Inventory: ${inventory.length === 0 ? 'empty' : inventory.map(i => `${i.item_name}(${i.quantity})`).join(', ')}`);
    console.log(`Recent memory: ${memory.length} entries`);

    db.close();
  });

program.parse();
