import type { TickResult } from '../engine/tick-loop.js';

type LogCategory = 'info' | 'warn' | 'error' | 'tick' | 'action' | 'death' | 'event' | 'cost' | 'council';

export function log(category: LogCategory, message: string): void {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${category.toUpperCase()}]`;
  if (category === 'error') {
    console.error(`${prefix} ${message}`);
  } else if (category === 'warn') {
    console.warn(`${prefix} ${message}`);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

export function logTickSummary(result: TickResult): void {
  log('tick', `Tick ${result.tick} complete | Epoch ${result.epoch}`);

  for (const action of result.actions) {
    const status = action.success ? 'OK' : 'FAIL';
    log('action', `  ${action.agentId}: ${action.action} -> ${status} (${action.result})`);
  }

  for (const death of result.deaths) {
    log('death', `  ${death.agentName} died: ${death.cause}`);
  }

  for (const event of result.events) {
    log('event', `  ${event.name}: ${event.description}`);
  }

  if (result.tokenUsage.input > 0 || result.tokenUsage.output > 0) {
    log('cost', `  Tokens: ${result.tokenUsage.input} in / ${result.tokenUsage.output} out | Cost: $${result.cost.toFixed(4)}`);
  }
}
