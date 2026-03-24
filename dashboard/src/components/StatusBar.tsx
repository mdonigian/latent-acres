import React, { useState, useCallback, useEffect } from 'react';
import type { StatusData } from '../types.js';

const TICK_PRESETS = [1, 5, 10, 30, 60, 120];

export function StatusBar({ status, connected }: { status: StatusData | null; connected: boolean }) {
  const [toggling, setToggling] = useState(false);
  const [tickDelay, setTickDelay] = useState<number | null>(null);

  // Fetch current tick delay on mount
  useEffect(() => {
    fetch('/api/sim/status')
      .then(r => r.json())
      .then(d => setTickDelay(d.tickDelaySec ?? null))
      .catch(() => {});
  }, []);

  const toggleSimulation = useCallback(async () => {
    if (!status || toggling) return;
    setToggling(true);
    try {
      const endpoint = status.status === 'running' ? '/api/sim/pause' : '/api/sim/start';
      await fetch(endpoint, { method: 'POST' });
    } catch (err) {
      console.error('Failed to toggle simulation:', err);
    }
    setToggling(false);
  }, [status, toggling]);

  const changeTickDelay = useCallback(async (sec: number) => {
    try {
      await fetch('/api/sim/tick-delay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seconds: sec }),
      });
      setTickDelay(sec);
    } catch (err) {
      console.error('Failed to set tick delay:', err);
    }
  }, []);

  if (!status) return <div className="bg-gray-800 text-white p-3">Loading...</div>;

  const isRunning = status.status === 'running';

  return (
    <div className="bg-gray-800/90 border-b border-gray-700/50 text-white px-4 py-2.5 flex items-center gap-4 text-sm">
      <span className="font-bold text-base font-serif tracking-wide text-amber-100/80">Latent Acres</span>

      <div className="h-4 w-px bg-gray-600/50" />

      {/* Play/Pause button */}
      <button
        onClick={toggleSimulation}
        disabled={toggling}
        className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors ${
          isRunning
            ? 'bg-amber-600/20 text-amber-300 hover:bg-amber-600/30 border border-amber-600/30'
            : 'bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30 border border-emerald-600/30'
        } ${toggling ? 'opacity-50' : ''}`}
      >
        <span className="text-sm">{isRunning ? '\u{23F8}' : '\u{25B6}'}</span>
        {isRunning ? 'Pause' : 'Start'}
      </button>

      {/* Tick speed selector */}
      <div className="flex items-center gap-1.5">
        <span className="text-gray-500 text-xs">Speed:</span>
        <select
          value={tickDelay ?? ''}
          onChange={e => changeTickDelay(Number(e.target.value))}
          className="bg-gray-700/50 text-white text-xs px-2 py-1 rounded-md border border-gray-600/30 focus:outline-none focus:border-blue-500/50"
        >
          {TICK_PRESETS.map(s => (
            <option key={s} value={s}>{s}s</option>
          ))}
        </select>
      </div>

      <div className="h-4 w-px bg-gray-600/50" />

      <span className="text-gray-400">Tick <span className="text-white tabular-nums">{status.tick}</span></span>
      <span className="text-gray-400">Epoch <span className="text-white tabular-nums">{status.epoch}</span></span>
      <span className="text-gray-400">Phase <span className="text-white">{status.phase}</span></span>

      <div className="h-4 w-px bg-gray-600/50" />

      <span className="text-gray-400">
        Agents <span className="text-white tabular-nums">{status.livingAgents}/{status.totalAgents}</span>
      </span>
      <span className="text-gray-400">
        Cost <span className="text-white tabular-nums">${status.cost.toFixed(2)}</span>
      </span>

      <span className="ml-auto flex items-center gap-1.5 text-xs">
        <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`} />
        <span className="text-gray-500">{connected ? 'Live' : 'Offline'}</span>
      </span>
    </div>
  );
}
