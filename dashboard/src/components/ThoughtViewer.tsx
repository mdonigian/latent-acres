import React, { useState, useEffect } from 'react';
import type { AgentData } from '../types.js';

interface Thought {
  tick: number;
  epoch: number;
  data: { thought?: string };
}

export function ThoughtViewer({ agents }: { agents: AgentData[] }) {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [thoughts, setThoughts] = useState<Thought[]>([]);

  useEffect(() => {
    if (!selectedAgent) { setThoughts([]); return; }
    fetch(`/api/agents/${selectedAgent}/thoughts`)
      .then(r => r.json())
      .then(setThoughts)
      .catch(() => setThoughts([]));
  }, [selectedAgent]);

  return (
    <div className="p-4 space-y-2 text-sm">
      <div className="flex items-center gap-2">
        <h3 className="font-bold">Agent Thoughts</h3>
        <select
          value={selectedAgent ?? ''}
          onChange={e => setSelectedAgent(e.target.value || null)}
          className="bg-gray-700 text-white text-xs px-2 py-1 rounded"
        >
          <option value="">Select agent...</option>
          {agents.filter(a => a.isAlive).map(a => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>
      {thoughts.length === 0 && <p className="text-gray-500">No thoughts recorded yet.</p>}
      <div className="space-y-1">
        {thoughts.map((t, i) => (
          <div key={i} className="text-xs">
            <span className="text-gray-500">[Tick {t.tick}]</span> {t.data.thought ?? ''}
          </div>
        ))}
      </div>
    </div>
  );
}
