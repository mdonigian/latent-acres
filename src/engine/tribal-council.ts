import type Database from 'better-sqlite3';
import {
  getLivingAgents, getChieftain, setChieftain, banishAgent,
  scatterInventoryAtLocation, appendEvent, getSimulation, updateSimulation,
  createMotion, secondMotion, getMotionsByEpoch, getMotion,
  updateMotionStatus, updateMotionTally,
  recordCouncilVote, getVotesForMotion,
  getAgent,
} from '../db/queries.js';
import { SeededRNG } from '../rng.js';

export type MotionType = 'general' | 'banishment' | 'resource_allocation' | 'exploration_mandate' | 'no_confidence' | 'election' | 'custom';

export interface CouncilResult {
  motions: {
    id: number;
    type: string;
    text: string;
    proposedBy: string;
    secondedBy: string | null;
    status: string;
    ayes: number;
    nays: number;
    abstentions: number;
  }[];
  newChieftain: string | null;
  banished: string[];
  events: string[];
}

export function shouldTriggerCouncil(tick: number, ticksPerEpoch: number): boolean {
  return tick > 0 && tick % ticksPerEpoch === 0;
}

export function proposeMotion(
  db: Database.Database,
  proposerId: string,
  motionType: MotionType,
  motionText: string,
  targetAgentId?: string,
): number {
  const sim = getSimulation(db);

  if (motionType === 'no_confidence') {
    const chieftain = getChieftain(db);
    if (!chieftain) throw new Error('No chieftain to target with no_confidence');
    targetAgentId = chieftain.id;
  }

  return createMotion(db, {
    epoch: sim.current_epoch,
    motionType,
    motionText,
    proposedBy: proposerId,
    targetAgentId,
    tick: sim.current_tick,
  });
}

export function secondMotionAction(
  db: Database.Database,
  motionId: number,
  seconderId: string,
): { success: boolean; reason?: string } {
  const motion = getMotion(db, motionId);
  if (!motion) return { success: false, reason: 'Motion not found' };
  if (motion.proposed_by === seconderId) return { success: false, reason: 'Cannot second your own motion' };
  if (motion.status !== 'proposed') return { success: false, reason: 'Motion already seconded or resolved' };

  secondMotion(db, motionId, seconderId);
  return { success: true };
}

export function castVote(
  db: Database.Database,
  motionId: number,
  voterId: string,
  vote: 'aye' | 'nay' | 'abstain',
): void {
  const sim = getSimulation(db);
  recordCouncilVote(db, motionId, sim.current_epoch, voterId, vote, sim.current_tick);
}

export function tallyAndResolve(
  db: Database.Database,
  motionId: number,
  rng: SeededRNG,
): { passed: boolean; ayes: number; nays: number; abstentions: number } {
  const sim = getSimulation(db);
  const motion = getMotion(db, motionId)!;
  const votes = getVotesForMotion(db, motionId);

  let ayes = 0, nays = 0, abstentions = 0;
  for (const v of votes) {
    if (v.vote === 'aye') ayes++;
    else if (v.vote === 'nay') nays++;
    else abstentions++;
  }

  let passed: boolean;
  if (motion.motion_type === 'election') {
    // Elections are handled separately via resolveElection
    passed = true;
  } else if (ayes === nays) {
    // Tie: Chieftain breaks it
    const chieftain = getChieftain(db);
    if (chieftain) {
      const chieftainVote = votes.find(v => v.voter_agent_id === chieftain.id);
      if (chieftainVote && chieftainVote.vote === 'aye') {
        passed = true;
      } else {
        // Chieftain abstained or voted nay => motion fails
        passed = false;
      }
    } else {
      passed = false;
    }
  } else {
    passed = ayes > nays;
  }

  updateMotionTally(db, motionId, ayes, nays, abstentions);
  updateMotionStatus(db, motionId, passed ? 'passed' : 'failed');

  // Apply effects if passed
  if (passed) {
    if (motion.motion_type === 'banishment' && motion.target_agent_id) {
      const target = getAgent(db, motion.target_agent_id);
      if (target && target.is_alive) {
        banishAgent(db, motion.target_agent_id, sim.current_tick, sim.current_epoch);
        scatterInventoryAtLocation(db, motion.target_agent_id, target.location_id);
        appendEvent(db, {
          tick: sim.current_tick, epoch: sim.current_epoch,
          eventType: 'banishment', agentId: motion.target_agent_id,
          dataJson: JSON.stringify({ motionId, motionText: motion.motion_text }),
        });
      }
    } else if (motion.motion_type === 'no_confidence' && motion.target_agent_id) {
      setChieftain(db, motion.target_agent_id, false);
      appendEvent(db, {
        tick: sim.current_tick, epoch: sim.current_epoch,
        eventType: 'no_confidence_passed', agentId: motion.target_agent_id,
        dataJson: JSON.stringify({ motionId }),
      });
    }
  }

  appendEvent(db, {
    tick: sim.current_tick, epoch: sim.current_epoch,
    eventType: 'motion_resolved',
    dataJson: JSON.stringify({
      motionId, type: motion.motion_type, passed, ayes, nays, abstentions,
    }),
  });

  return { passed, ayes, nays, abstentions };
}

export function resolveElection(
  db: Database.Database,
  motionId: number,
  rng: SeededRNG,
): string | null {
  const sim = getSimulation(db);
  const votes = getVotesForMotion(db, motionId);

  // Each 'aye' vote's voter_agent_id field stores the nominee they're voting for
  // For simplicity in our election, each vote's `vote` field contains the nominee agent ID
  const tally = new Map<string, number>();
  for (const v of votes) {
    if (v.vote === 'abstain') continue;
    // In election, vote field is the nominee's agent ID
    const nominee = v.vote;
    tally.set(nominee, (tally.get(nominee) ?? 0) + 1);
  }

  if (tally.size === 0) return null;

  // Find the highest vote count
  let maxVotes = 0;
  for (const count of tally.values()) {
    if (count > maxVotes) maxVotes = count;
  }

  const candidates = [...tally.entries()].filter(([, c]) => c === maxVotes).map(([id]) => id);
  const winner = candidates.length === 1 ? candidates[0] : rng.pick(candidates);

  setChieftain(db, winner, true);
  updateMotionStatus(db, motionId, 'passed');

  appendEvent(db, {
    tick: sim.current_tick, epoch: sim.current_epoch,
    eventType: 'election_result', agentId: winner,
    dataJson: JSON.stringify({ motionId, winner }),
  });

  return winner;
}

export function runCouncilPhase(
  db: Database.Database,
  rng: SeededRNG,
  motionInputs: {
    proposerId: string;
    type: MotionType;
    text: string;
    targetAgentId?: string;
  }[],
  secondInputs: { motionId: number; seconderId: string }[],
  voteInputs: { motionId: number; voterId: string; vote: string }[],
): CouncilResult {
  const sim = getSimulation(db);
  const result: CouncilResult = { motions: [], newChieftain: null, banished: [], events: [] };

  updateSimulation(db, { phase: 'council_motions' });

  appendEvent(db, {
    tick: sim.current_tick, epoch: sim.current_epoch,
    eventType: 'council_call_to_order',
    dataJson: JSON.stringify({ epoch: sim.current_epoch }),
  });

  // Phase 1: Propose motions
  for (const input of motionInputs) {
    proposeMotion(db, input.proposerId, input.type, input.text, input.targetAgentId);
  }

  // Phase 2: Second motions
  for (const input of secondInputs) {
    secondMotionAction(db, input.motionId, input.seconderId);
  }

  // Mark unseconded motions as died
  const motions = getMotionsByEpoch(db, sim.current_epoch);
  for (const m of motions) {
    if (m.status === 'proposed') {
      updateMotionStatus(db, m.id, 'died');
    }
  }

  // Phase 3: Debate (handled externally via agent prompts)
  updateSimulation(db, { phase: 'council_debate' });

  // Phase 4: Vote on seconded motions
  updateSimulation(db, { phase: 'council_vote' });

  for (const input of voteInputs) {
    castVote(db, input.motionId, input.voterId, input.vote as 'aye' | 'nay' | 'abstain');
  }

  // Tally and resolve seconded motions
  const updatedMotions = getMotionsByEpoch(db, sim.current_epoch);
  for (const m of updatedMotions) {
    if (m.status === 'seconded') {
      const tally = tallyAndResolve(db, m.id, rng);

      // If no_confidence passed, auto-raise election
      if (m.motion_type === 'no_confidence' && tally.passed) {
        const electionId = proposeMotion(db, m.proposed_by, 'election', 'Election for new Chieftain');
        // Auto-second election
        const living = getLivingAgents(db);
        if (living.length > 1) {
          const seconder = living.find(a => a.id !== m.proposed_by);
          if (seconder) secondMotionAction(db, electionId, seconder.id);
        }
        result.events.push('Election auto-raised after no confidence vote');
      }

      if (m.motion_type === 'banishment' && tally.passed && m.target_agent_id) {
        result.banished.push(m.target_agent_id);
      }
    }
  }

  // Handle elections
  const finalMotions = getMotionsByEpoch(db, sim.current_epoch);
  for (const m of finalMotions) {
    if (m.motion_type === 'election' && m.status === 'seconded') {
      const winner = resolveElection(db, m.id, rng);
      if (winner) result.newChieftain = winner;
    }
  }

  // Build result
  const allMotions = getMotionsByEpoch(db, sim.current_epoch);
  for (const m of allMotions) {
    result.motions.push({
      id: m.id,
      type: m.motion_type,
      text: m.motion_text,
      proposedBy: m.proposed_by,
      secondedBy: m.seconded_by,
      status: m.status,
      ayes: m.ayes,
      nays: m.nays,
      abstentions: m.abstentions,
    });
  }

  // If no seconded motions existed, council adjourns
  if (allMotions.every(m => m.status === 'died' || m.status === 'proposed')) {
    result.events.push('Council adjourned with no votes taken');
  }

  // Return to tick phase
  updateSimulation(db, { phase: 'tick' });

  appendEvent(db, {
    tick: sim.current_tick, epoch: sim.current_epoch,
    eventType: 'council_adjourned',
    dataJson: JSON.stringify(result),
  });

  return result;
}
