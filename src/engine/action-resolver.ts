import type Database from 'better-sqlite3';
import type { AgentAction } from '../agents/orchestrator.js';
import { getAgent, updateAgentStats, getResourcesAtLocation, addInventoryItem, getAgentInventory, appendEvent, getSimulation, getLocation, removeInventoryItem, updateInventoryQuantity, updateResourceQuantity, getLivingAgents, adjustRelationship } from '../db/queries.js';
import { depleteResource } from './resource-manager.js';
import { craft } from '../world/crafting.js';
import { SeededRNG } from '../rng.js';
import { DEFAULT_ISLAND, isAdjacent } from '../world/island.js';

export interface ResolvedAction {
  agentId: string;
  agentName: string;
  action: string;
  result: string;
  success: boolean;
}

export function resolveActions(
  db: Database.Database,
  actions: AgentAction[],
  rng: SeededRNG,
): ResolvedAction[] {
  const sim = getSimulation(db);
  const results: ResolvedAction[] = [];

  // Group gather actions by location+resource for conflict resolution
  const gatherGroups = new Map<string, AgentAction[]>();
  const otherActions: AgentAction[] = [];

  for (const action of actions) {
    if (action.action === 'gather') {
      const agent = getAgent(db, action.agentId);
      if (!agent) continue;
      const key = `${agent.location_id}:${action.params.resource}`;
      if (!gatherGroups.has(key)) gatherGroups.set(key, []);
      gatherGroups.get(key)!.push(action);
    } else {
      otherActions.push(action);
    }
  }

  // Resolve gathers with conflict resolution
  for (const [key, gathers] of gatherGroups) {
    const [locationId, resourceType] = key.split(':');
    const resources = getResourcesAtLocation(db, locationId);
    const resource = resources.find(r => r.type === resourceType);

    if (!resource || resource.quantity <= 0) {
      for (const g of gathers) {
        results.push({ agentId: g.agentId, agentName: g.agentName, action: 'gather', result: `No ${resourceType} available`, success: false });
      }
      continue;
    }

    // Split proportionally based on number of gatherers
    const totalDemand = gathers.length;
    const available = resource.quantity;
    const perAgent = Math.max(1, Math.floor(available / totalDemand));

    let totalGathered = 0;
    for (const g of gathers) {
      const amount = Math.min(perAgent, available - totalGathered);
      if (amount <= 0) {
        results.push({ agentId: g.agentId, agentName: g.agentName, action: 'gather', result: 'Resource depleted', success: false });
        continue;
      }

      totalGathered += amount;
      const agent = getAgent(db, g.agentId)!;
      updateAgentStats(db, g.agentId, { energy: Math.max(0, agent.energy - g.energyCost) });

      addInventoryItem(db, {
        id: `${g.agentId}_${resourceType}_${sim.current_tick}_${rng.randomInt(0, 99999)}`,
        agentId: g.agentId,
        itemName: resourceType,
        itemType: 'resource',
        quantity: amount,
      });

      results.push({ agentId: g.agentId, agentName: g.agentName, action: 'gather', result: `Gathered ${amount} ${resourceType}`, success: true });

      appendEvent(db, {
        tick: sim.current_tick, epoch: sim.current_epoch,
        eventType: 'gather', agentId: g.agentId, locationId,
        dataJson: JSON.stringify({ resource: resourceType, amount }),
      });
    }

    depleteResource(db, resource.id, resource.quantity, totalGathered);
  }

  // Resolve other actions
  for (const action of otherActions) {
    const agent = getAgent(db, action.agentId);
    if (!agent) continue;

    switch (action.action) {
      case 'rest': {
        const baseRecovery = 25 + rng.randomInt(0, 15);
        const inventory = getAgentInventory(db, agent.id);
        const hasShelter = inventory.some(i => i.item_name === 'shelter');
        const recovery = hasShelter ? baseRecovery + 10 : baseRecovery;
        const newEnergy = Math.min(100, agent.energy + recovery);
        updateAgentStats(db, agent.id, { energy: newEnergy });
        results.push({ agentId: action.agentId, agentName: action.agentName, action: 'rest', result: `Recovered ${newEnergy - agent.energy} energy`, success: true });

        appendEvent(db, {
          tick: sim.current_tick, epoch: sim.current_epoch,
          eventType: 'rest', agentId: action.agentId,
          dataJson: JSON.stringify({ energyGained: newEnergy - agent.energy }),
        });
        break;
      }

      case 'move': {
        const dest = action.params.destination as string;
        if (!isAdjacent(DEFAULT_ISLAND, agent.location_id, dest)) {
          results.push({ agentId: action.agentId, agentName: action.agentName, action: 'move', result: `Cannot move to ${dest}: not adjacent`, success: false });
          break;
        }
        updateAgentStats(db, agent.id, { location_id: dest, energy: Math.max(0, agent.energy - action.energyCost) });
        results.push({ agentId: action.agentId, agentName: action.agentName, action: 'move', result: `Moved to ${dest}`, success: true });

        appendEvent(db, {
          tick: sim.current_tick, epoch: sim.current_epoch,
          eventType: 'move', agentId: action.agentId,
          dataJson: JSON.stringify({ from: agent.location_id, to: dest }),
        });
        break;
      }

      case 'eat': {
        const itemName = action.params.item as string;
        const inventory = getAgentInventory(db, agent.id);
        const food = inventory.find(i => i.item_name === itemName);
        if (!food) {
          results.push({ agentId: action.agentId, agentName: action.agentName, action: 'eat', result: `No ${itemName} in inventory`, success: false });
          break;
        }
        const nutrition = 25; // Default nutrition value
        const newHunger = Math.max(0, agent.hunger - nutrition);
        updateAgentStats(db, agent.id, { hunger: newHunger });
        if (food.quantity <= 1) {
          removeInventoryItem(db, food.id);
        } else {
          updateInventoryQuantity(db, food.id, food.quantity - 1);
        }
        results.push({ agentId: action.agentId, agentName: action.agentName, action: 'eat', result: `Ate ${itemName}, hunger -${nutrition}`, success: true });

        appendEvent(db, {
          tick: sim.current_tick, epoch: sim.current_epoch,
          eventType: 'eat', agentId: action.agentId,
          dataJson: JSON.stringify({ item: itemName, hungerReduction: nutrition }),
        });
        break;
      }

      case 'craft': {
        const recipeId = action.params.recipe as string;
        updateAgentStats(db, agent.id, { energy: Math.max(0, agent.energy - action.energyCost) });
        const craftResult = craft(db, agent.id, recipeId);
        if (craftResult.success) {
          results.push({ agentId: action.agentId, agentName: action.agentName, action: 'craft', result: `Crafted ${craftResult.outputItem}`, success: true });
          appendEvent(db, {
            tick: sim.current_tick, epoch: sim.current_epoch,
            eventType: 'craft', agentId: action.agentId,
            dataJson: JSON.stringify({ recipe: recipeId, output: craftResult.outputItem }),
          });
        } else {
          results.push({ agentId: action.agentId, agentName: action.agentName, action: 'craft', result: craftResult.reason!, success: false });
        }
        break;
      }

      case 'explore': {
        updateAgentStats(db, agent.id, { energy: Math.max(0, agent.energy - action.energyCost) });
        const discoveryRoll = rng.random();
        if (discoveryRoll < 0.3) {
          results.push({ agentId: action.agentId, agentName: action.agentName, action: 'explore', result: 'Discovered some hidden resources!', success: true });
          const resources = getResourcesAtLocation(db, agent.location_id);
          if (resources.length > 0) {
            const res = rng.pick(resources);
            const bonus = rng.randomInt(1, 3);
            const newQty = Math.min(res.quantity + bonus, res.max_quantity);
            updateResourceQuantity(db, res.id, newQty);
          }
        } else {
          results.push({ agentId: action.agentId, agentName: action.agentName, action: 'explore', result: 'Found nothing of interest.', success: false });
        }

        appendEvent(db, {
          tick: sim.current_tick, epoch: sim.current_epoch,
          eventType: 'explore', agentId: action.agentId, locationId: agent.location_id,
          dataJson: JSON.stringify({ focus: action.params.focus }),
        });
        break;
      }

      case 'internal_monologue': {
        results.push({ agentId: action.agentId, agentName: action.agentName, action: 'internal_monologue', result: 'Thought recorded', success: true });

        appendEvent(db, {
          tick: sim.current_tick, epoch: sim.current_epoch,
          eventType: 'internal_monologue', agentId: action.agentId,
          dataJson: JSON.stringify({ thought: action.params.thought }),
        });
        break;
      }

      case 'check_relationships': {
        results.push({ agentId: action.agentId, agentName: action.agentName, action: 'check_relationships', result: 'Relationships reviewed', success: true });
        break;
      }

      case 'speak': {
        const message = String(action.params.message ?? '').slice(0, 200);
        const target = String(action.params.target ?? 'all');
        const isWhisper = target !== 'all';

        // Find target agent if whisper
        let targetAgent = null;
        if (isWhisper) {
          const allAgents = getLivingAgents(db);
          targetAgent = allAgents.find(a => a.name.toLowerCase() === target.toLowerCase());
          if (!targetAgent) {
            results.push({ agentId: action.agentId, agentName: action.agentName, action: 'speak', result: `Agent "${target}" not found`, success: false });
            break;
          }
        }

        results.push({
          agentId: action.agentId, agentName: action.agentName, action: 'speak',
          result: isWhisper ? `Whispered to ${target}: "${message}"` : `Said: "${message}"`,
          success: true,
        });

        // Speaking positively adjusts relationships
        if (targetAgent) {
          adjustRelationship(db, action.agentId, targetAgent.id, 2, sim.current_tick);
        } else {
          // Public speech: small positive bump with all co-located agents
          const colocated = getLivingAgents(db).filter(a => a.id !== action.agentId && a.location_id === agent.location_id);
          for (const other of colocated) {
            adjustRelationship(db, action.agentId, other.id, 1, sim.current_tick);
          }
        }

        appendEvent(db, {
          tick: sim.current_tick, epoch: sim.current_epoch,
          eventType: 'speech', agentId: action.agentId,
          dataJson: JSON.stringify({
            from: action.agentName,
            message,
            target: isWhisper ? target : 'all',
            target_id: targetAgent?.id,
            location_id: agent.location_id,
            isWhisper,
          }),
        });
        break;
      }

      case 'give': {
        const targetName = String(action.params.target ?? '');
        const itemName = String(action.params.item ?? '');
        const allAgents = getLivingAgents(db);
        const targetAgent = allAgents.find(a => a.name.toLowerCase() === targetName.toLowerCase());

        if (!targetAgent) {
          results.push({ agentId: action.agentId, agentName: action.agentName, action: 'give', result: `Agent "${targetName}" not found`, success: false });
          break;
        }
        if (targetAgent.location_id !== agent.location_id) {
          results.push({ agentId: action.agentId, agentName: action.agentName, action: 'give', result: `${targetName} is not at your location`, success: false });
          break;
        }

        const inv = getAgentInventory(db, action.agentId);
        const item = inv.find(i => i.item_name === itemName);
        if (!item) {
          results.push({ agentId: action.agentId, agentName: action.agentName, action: 'give', result: `No "${itemName}" in inventory`, success: false });
          break;
        }

        // Transfer item
        if (item.quantity <= 1) {
          removeInventoryItem(db, item.id);
        } else {
          updateInventoryQuantity(db, item.id, item.quantity - 1);
        }
        addInventoryItem(db, {
          id: `${targetAgent.id}_${itemName}_gift_${sim.current_tick}_${Math.random().toString(36).slice(2, 6)}`,
          agentId: targetAgent.id,
          itemName: item.item_name,
          itemType: item.item_type,
          quantity: 1,
        });

        adjustRelationship(db, action.agentId, targetAgent.id, 8, sim.current_tick);

        results.push({ agentId: action.agentId, agentName: action.agentName, action: 'give', result: `Gave ${itemName} to ${targetName}`, success: true });

        appendEvent(db, {
          tick: sim.current_tick, epoch: sim.current_epoch,
          eventType: 'give', agentId: action.agentId, targetAgentId: targetAgent.id,
          dataJson: JSON.stringify({ item: itemName, target: targetName }),
        });
        break;
      }

      case 'trade': {
        // Log the trade proposal — actual matching is complex, for now just record it
        const targetName = String(action.params.target ?? '');
        results.push({ agentId: action.agentId, agentName: action.agentName, action: 'trade', result: `Proposed trade to ${targetName}`, success: true });

        appendEvent(db, {
          tick: sim.current_tick, epoch: sim.current_epoch,
          eventType: 'speech', agentId: action.agentId,
          dataJson: JSON.stringify({
            from: action.agentName,
            message: `I'd like to trade my ${action.params.offer_item} for your ${action.params.request_type}`,
            target: targetName,
            location_id: agent.location_id,
            isWhisper: false,
          }),
        });
        break;
      }

      case 'form_alliance': {
        const targetName = String(action.params.target ?? '');
        const allianceName = String(action.params.alliance_name ?? 'Alliance');
        const allAgents = getLivingAgents(db);
        const targetAgent = allAgents.find(a => a.name.toLowerCase() === targetName.toLowerCase());

        if (targetAgent) {
          adjustRelationship(db, action.agentId, targetAgent.id, 10, sim.current_tick);
        }

        results.push({ agentId: action.agentId, agentName: action.agentName, action: 'form_alliance', result: `Proposed alliance "${allianceName}" to ${targetName}`, success: true });

        appendEvent(db, {
          tick: sim.current_tick, epoch: sim.current_epoch,
          eventType: 'speech', agentId: action.agentId,
          dataJson: JSON.stringify({
            from: action.agentName,
            message: `I propose we form an alliance: "${allianceName}"`,
            target: targetName,
            location_id: agent.location_id,
            isWhisper: true,
          }),
        });
        break;
      }

      case 'betray_alliance': {
        results.push({ agentId: action.agentId, agentName: action.agentName, action: 'betray_alliance', result: `Secretly left alliance "${action.params.alliance_name}"`, success: true });

        appendEvent(db, {
          tick: sim.current_tick, epoch: sim.current_epoch,
          eventType: 'betray_alliance', agentId: action.agentId,
          dataJson: JSON.stringify({ alliance: action.params.alliance_name }),
        });
        break;
      }

      default:
        results.push({ agentId: action.agentId, agentName: action.agentName, action: action.action, result: `Unknown action: ${action.action}`, success: false });
    }
  }

  return results;
}
