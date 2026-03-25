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
    <div className="text-white px-4 py-2.5 flex items-center gap-4 text-sm border-b border-white/5" style={{ background: 'linear-gradient(90deg, rgba(10,18,30,0.95) 0%, rgba(20,30,50,0.9) 50%, rgba(10,18,30,0.95) 100%)' }}>
      <span className="font-bold text-lg font-serif tracking-wide bg-gradient-to-r from-amber-200 to-amber-400 bg-clip-text text-transparent">Latent Acres</span>

      <div className="h-4 w-px bg-gray-600/50" />

      {/* Play/Pause button */}
      <button
        onClick={toggleSimulation}
        disabled={toggling}
        className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
          isRunning
            ? 'bg-gradient-to-r from-amber-700/40 to-amber-600/30 text-amber-200 hover:from-amber-700/50 hover:to-amber-600/40 border border-amber-500/20 shadow-lg shadow-amber-900/10'
            : 'bg-gradient-to-r from-emerald-700/40 to-emerald-600/30 text-emerald-200 hover:from-emerald-700/50 hover:to-emerald-600/40 border border-emerald-500/20 shadow-lg shadow-emerald-900/10 pulse-glow'
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
          className="bg-white/5 text-gray-300 text-xs px-2 py-1.5 rounded-lg border border-white/10 focus:outline-none focus:border-amber-500/30 appearance-none"
        >
          {TICK_PRESETS.map(s => (
            <option key={s} value={s}>{s}s</option>
          ))}
        </select>
      </div>

      <div className="h-4 w-px bg-gray-600/50" />

      <span className="text-gray-500 text-xs">Tick <span className="text-gray-200 font-mono tabular-nums">{status.tick}</span></span>
      <span className="text-gray-500 text-xs">Epoch <span className="text-gray-200 font-mono tabular-nums">{status.epoch}</span></span>
      <span className="text-gray-500 text-xs">Phase <span className="text-gray-200">{status.phase}</span></span>

      <div className="h-4 w-px bg-white/10" />

      <span className="text-gray-500 text-xs">
        Agents <span className="text-gray-200 font-mono tabular-nums">{status.livingAgents}<span className="text-gray-600">/{status.totalAgents}</span></span>
      </span>
      <span className="text-gray-500 text-xs">
        Cost <span className="text-amber-300/70 font-mono tabular-nums">${status.cost.toFixed(2)}</span>
      </span>

      <span className="ml-auto flex items-center gap-2 text-xs">
        <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400 shadow-lg shadow-emerald-400/50' : 'bg-red-400'}`} />
        <span className="text-gray-600">{connected ? 'Live' : 'Offline'}</span>
      </span>
    </div>
  );
}
