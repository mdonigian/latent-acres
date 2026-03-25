import React from 'react';
import { createPortal } from 'react-dom';
import Markdown from 'react-markdown';
import type { AgentData, AgentDetail } from '../types.js';

const ITEM_ICONS: Record<string, string> = {
  food: '\u{1F356}',
  wood: '\u{1FAB5}',
  stone: '\u{1FAA8}',
  fiber: '\u{1F9F6}',
  freshwater: '\u{1F4A7}',
  'Fishing Spear': '\u{1F531}',
  'Fire Starter': '\u{1F525}',
  'Snare Trap': '\u{1FAA4}',
  Raft: '\u{1F6F6}',
  Medicine: '\u{1F48A}',
  'shelter_upgrade': '\u{1F3D7}',
};

function StatBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-14 text-gray-400">{label}</span>
      <div className="flex-1 bg-white/5 rounded-full h-1.5 overflow-hidden">
        <div className={`h-1.5 rounded-full ${color} transition-all duration-500 stat-bar-shimmer`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right tabular-nums">{value}</span>
    </div>
  );
}

function getMoodEmoji(agent: AgentData): string {
  if (agent.energy < 20) return '\u{1F634}'; // exhausted
  if (agent.hunger > 60 || agent.health < 50) return '\u{1F630}'; // anxious
  if (agent.health > 70 && agent.hunger < 30) return '\u{1F60A}'; // happy
  return '\u{1F610}'; // content
}

function AgentCard({ agent, selected, onClick }: { agent: AgentData; selected: boolean; onClick: () => void }) {
  const dead = !agent.isAlive || agent.isBanished;
  return (
    <div
      onClick={onClick}
      className={`p-3 rounded-lg cursor-pointer border transition-all ${
        selected ? 'border-blue-400/60 bg-blue-900/20 shadow-lg shadow-blue-500/5' : 'border-gray-700/50 bg-gray-800/40 hover:bg-gray-800/60'
      } ${dead ? 'opacity-40' : ''}`}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="font-semibold text-sm">{agent.name}</span>
        {!dead && <span data-testid={`mood-${agent.id}`} title="mood">{getMoodEmoji(agent)}</span>}
        {agent.isChieftain && <span title="Chieftain">{'\u{1F451}'}</span>}
        {dead && <span className="text-red-400 text-xs ml-auto">{agent.isBanished ? 'Banished' : 'Dead'}</span>}
      </div>
      {!dead && (
        <div className="space-y-1">
          <StatBar label="Health" value={agent.health} max={100} color="bg-red-500" />
          <StatBar label="Hunger" value={agent.hunger} max={100} color="bg-orange-500" />
          <StatBar label="Energy" value={agent.energy} max={100} color="bg-blue-500" />
        </div>
      )}
      <div className="text-xs text-gray-500 mt-1.5">{agent.location}</div>
    </div>
  );
}

function aggregateInventory(items: { name: string; type: string; quantity: number }[]) {
  const agg = new Map<string, { name: string; type: string; total: number }>();
  for (const item of items) {
    const key = item.name;
    const existing = agg.get(key);
    if (existing) {
      existing.total += item.quantity;
    } else {
      agg.set(key, { name: item.name, type: item.type, total: item.quantity });
    }
  }
  return [...agg.values()];
}

function AgentModal({
  detail,
  onClose,
}: {
  detail: AgentDetail;
  onClose: () => void;
}) {
  const dead = !detail.isAlive || detail.isBanished;
  const inventory = aggregateInventory(detail.inventory);
  // personality_json is stored as { name, model, personality: { traits, backstory, ... } }
  const rawP = detail.personality as Record<string, unknown>;
  const personality = (rawP?.personality ?? rawP) as {
    traits?: string[];
    backstory?: string;
    communicationStyle?: string;
    values?: string[];
    hiddenAgenda?: string;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]" onClick={onClose}>
      <div
        className="bg-gray-800/95 border border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto m-4"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-700/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold">{detail.name}</h2>
            {detail.isChieftain && <span className="text-lg" title="Chieftain">{'\u{1F451}'}</span>}
            {dead && <span className="text-red-400 text-sm">{detail.isBanished ? 'Banished' : 'Dead'}</span>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none">{'\u{00D7}'}</button>
        </div>

        <div className="px-6 py-4 space-y-5">
          {/* Stats */}
          {!dead && (
            <div className="space-y-2">
              <StatBar label="Health" value={detail.health} max={100} color="bg-red-500" />
              <StatBar label="Hunger" value={detail.hunger} max={100} color="bg-orange-500" />
              <StatBar label="Energy" value={detail.energy} max={100} color="bg-blue-500" />
              <div className="text-xs text-gray-400 mt-1">Location: <span className="text-white">{detail.location}</span></div>
            </div>
          )}

          {/* Personality */}
          <div>
            <h3 className="text-sm font-semibold text-gray-300 mb-2 uppercase tracking-wider">Personality</h3>
            {personality.backstory && (
              <p className="text-sm text-gray-400 italic mb-2">{personality.backstory}</p>
            )}
            {personality.traits && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {personality.traits.map((t, i) => (
                  <span key={i} className="text-xs bg-gray-700/60 text-gray-300 px-2 py-0.5 rounded-full">{t}</span>
                ))}
              </div>
            )}
            {personality.communicationStyle && (
              <p className="text-xs text-gray-500">Style: {personality.communicationStyle}</p>
            )}
            {personality.values && (
              <p className="text-xs text-gray-500 mt-1">Values: {personality.values.join(', ')}</p>
            )}
          </div>

          {/* Inventory */}
          <div>
            <h3 className="text-sm font-semibold text-gray-300 mb-2 uppercase tracking-wider">Inventory</h3>
            {inventory.length === 0 ? (
              <p className="text-sm text-gray-500">Empty</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {inventory.map((item, i) => {
                  const icon = ITEM_ICONS[item.name] ?? '\u{1F4E6}';
                  return (
                    <div key={i} className="flex items-center gap-2 bg-gray-700/30 rounded-lg px-3 py-2">
                      <span className="text-lg">{icon}</span>
                      <div>
                        <div className="text-sm font-medium capitalize">{item.name}</div>
                        <div className="text-xs text-gray-400">{'\u{00D7}'}{item.total}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Relationships */}
          {detail.relationships.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-300 mb-2 uppercase tracking-wider">Relationships</h3>
              <div className="space-y-1">
                {detail.relationships.map((r, i) => {
                  const color = r.sentiment > 0 ? 'text-emerald-400' : r.sentiment < 0 ? 'text-red-400' : 'text-gray-400';
                  const bar = r.sentiment > 0 ? 'bg-emerald-500' : 'bg-red-500';
                  const width = Math.min(100, Math.abs(r.sentiment));
                  return (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className="w-20 truncate">{r.other}</span>
                      <div className="flex-1 bg-gray-700/50 rounded-full h-1.5">
                        <div className={`h-1.5 rounded-full ${bar}`} style={{ width: `${width}%` }} />
                      </div>
                      <span className={`w-8 text-right ${color} tabular-nums`}>{r.sentiment > 0 ? '+' : ''}{r.sentiment}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Journal entries */}
          {detail.journal && detail.journal.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-300 mb-2 uppercase tracking-wider flex items-center gap-2">
                <span>{'\u{1F4D6}'}</span> Journal
              </h3>
              <div className="space-y-3 max-h-60 overflow-y-auto">
                {detail.journal.map((j, i) => (
                  <div key={i} className="bg-amber-900/10 border border-amber-800/15 rounded-lg p-3">
                    <div className="text-[10px] text-amber-600/70 font-semibold mb-1.5 uppercase tracking-wider">
                      Epoch {j.epoch}
                    </div>
                    <div className="text-xs text-gray-300 leading-relaxed font-serif prose prose-invert prose-xs max-w-none">
                      <Markdown>{j.entry}</Markdown>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent events */}
          {detail.shortTermMemory.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-300 mb-2 uppercase tracking-wider">Recent Events</h3>
              <div className="space-y-0.5 text-xs font-mono max-h-40 overflow-y-auto">
                {detail.shortTermMemory.slice(0, 15).map((m, i) => (
                  <div key={i} className="flex gap-2 text-gray-400">
                    <span className="text-gray-600 w-6 text-right shrink-0">{m.tick}</span>
                    <span>{m.content}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function AgentCards({
  agents,
  selectedAgent,
  onSelectAgent,
  detail,
}: {
  agents: AgentData[];
  selectedAgent: string | null;
  onSelectAgent: (id: string | null) => void;
  detail: AgentDetail | null;
}) {
  return (
    <>
      <div className="flex flex-col gap-2 overflow-y-auto p-2">
        <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold px-1 py-1">
          Agents ({agents.filter(a => a.isAlive && !a.isBanished).length}/{agents.length})
        </div>
        {agents.map(agent => (
          <AgentCard
            key={agent.id}
            agent={agent}
            selected={selectedAgent === agent.id}
            onClick={() => onSelectAgent(selectedAgent === agent.id ? null : agent.id)}
          />
        ))}
      </div>
      {detail && createPortal(
        <AgentModal detail={detail} onClose={() => onSelectAgent(null)} />,
        document.body,
      )}
    </>
  );
}
