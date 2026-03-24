import type Database from 'better-sqlite3';
import {
  getAgent, getAgentInventory, removeInventoryItem, addInventoryItem,
  appendEvent, getSimulation, adjustRelationship,
  appendShortTermMemory, createAlliance, getAlliance, updateAllianceMembers,
} from '../db/queries.js';

const MAX_MESSAGE_LENGTH = 200;

export interface SocialActionResult {
  success: boolean;
  reason?: string;
}

export function speak(
  db: Database.Database,
  speakerId: string,
  message: string,
  targetAgentId?: string,
): SocialActionResult {
  const sim = getSimulation(db);
  const speaker = getAgent(db, speakerId);
  if (!speaker) return { success: false, reason: 'Speaker not found' };

  const trimmedMessage = message.slice(0, MAX_MESSAGE_LENGTH);
  const isWhisper = !!targetAgentId;

  if (isWhisper) {
    const target = getAgent(db, targetAgentId);
    if (!target) return { success: false, reason: 'Target agent not found' };
    if (target.location_id !== speaker.location_id) {
      return { success: false, reason: 'Target agent not at your location' };
    }

    appendShortTermMemory(db, {
      agentId: targetAgentId,
      tick: sim.current_tick,
      epoch: sim.current_epoch,
      type: 'whisper_received',
      content: `${speaker.name} whispers to you: "${trimmedMessage}"`,
      involvedAgents: [speakerId],
    });
  } else {
    // Public speech: deliver to all agents at the same location except the speaker
    const allAgents = db.prepare(
      'SELECT * FROM agents WHERE location_id = ? AND id != ? AND is_alive = 1 AND is_banished = 0'
    ).all(speaker.location_id, speakerId) as { id: string }[];

    for (const a of allAgents) {
      appendShortTermMemory(db, {
        agentId: a.id,
        tick: sim.current_tick,
        epoch: sim.current_epoch,
        type: 'speech_heard',
        content: `${speaker.name} says: "${trimmedMessage}"`,
        involvedAgents: [speakerId],
      });
    }
  }

  appendEvent(db, {
    tick: sim.current_tick,
    epoch: sim.current_epoch,
    eventType: isWhisper ? 'whisper' : 'speech',
    agentId: speakerId,
    targetAgentId: targetAgentId,
    locationId: speaker.location_id,
    dataJson: JSON.stringify({ message: trimmedMessage, isWhisper }),
  });

  return { success: true };
}

export function giveItem(
  db: Database.Database,
  giverId: string,
  receiverId: string,
  itemName: string,
): SocialActionResult {
  const sim = getSimulation(db);
  const giver = getAgent(db, giverId);
  const receiver = getAgent(db, receiverId);
  if (!giver || !receiver) return { success: false, reason: 'Agent not found' };
  if (giver.location_id !== receiver.location_id) {
    return { success: false, reason: 'Target agent not at your location' };
  }

  const inventory = getAgentInventory(db, giverId);
  const item = inventory.find(i => i.item_name === itemName);
  if (!item) return { success: false, reason: `No ${itemName} in inventory` };

  // Transfer item
  if (item.quantity <= 1) {
    removeInventoryItem(db, item.id);
  } else {
    db.prepare('UPDATE inventory SET quantity = ? WHERE id = ?').run(item.quantity - 1, item.id);
  }

  addInventoryItem(db, {
    id: `gift_${giverId}_${receiverId}_${sim.current_tick}_${itemName}`,
    agentId: receiverId,
    itemName: item.item_name,
    itemType: item.item_type,
    quantity: 1,
    propertiesJson: item.properties_json ?? undefined,
  });

  // Adjust relationship: gave_gift +8
  adjustRelationship(db, giverId, receiverId, 8, sim.current_tick);

  appendEvent(db, {
    tick: sim.current_tick,
    epoch: sim.current_epoch,
    eventType: 'give',
    agentId: giverId,
    targetAgentId: receiverId,
    dataJson: JSON.stringify({ item: itemName }),
  });

  return { success: true };
}

export function proposeAlliance(
  db: Database.Database,
  proposerId: string,
  targetId: string,
  allianceName: string,
): SocialActionResult {
  const sim = getSimulation(db);
  const proposer = getAgent(db, proposerId);
  const target = getAgent(db, targetId);
  if (!proposer || !target) return { success: false, reason: 'Agent not found' };
  if (proposerId === targetId) return { success: false, reason: 'Cannot form alliance with yourself' };
  if (proposer.location_id !== target.location_id) {
    return { success: false, reason: 'Target agent not at your location' };
  }

  const allianceId = `alliance_${proposerId}_${targetId}_${sim.current_tick}`;
  createAlliance(db, allianceId, allianceName, [proposerId, targetId], sim.current_tick);

  appendEvent(db, {
    tick: sim.current_tick,
    epoch: sim.current_epoch,
    eventType: 'alliance_formed',
    agentId: proposerId,
    targetAgentId: targetId,
    dataJson: JSON.stringify({ allianceName, allianceId }),
  });

  return { success: true };
}

export function betrayAlliance(
  db: Database.Database,
  agentId: string,
  allianceId: string,
): SocialActionResult {
  const sim = getSimulation(db);
  const alliance = getAlliance(db, allianceId);
  if (!alliance) return { success: false, reason: 'Alliance not found' };

  const members: string[] = JSON.parse(alliance.members_json);
  if (!members.includes(agentId)) return { success: false, reason: 'Not a member of this alliance' };

  const newMembers = members.filter(m => m !== agentId);
  updateAllianceMembers(db, allianceId, newMembers);

  // Silent betrayal — no notification to other members
  appendEvent(db, {
    tick: sim.current_tick,
    epoch: sim.current_epoch,
    eventType: 'alliance_betrayal',
    agentId,
    dataJson: JSON.stringify({ allianceId, allianceName: alliance.name }),
  });

  return { success: true };
}
