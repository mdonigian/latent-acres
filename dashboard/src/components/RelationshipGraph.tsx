import React from 'react';
import type { RelationshipData, AgentData } from '../types.js';

export function RelationshipGraph({ relationships, agents }: { relationships: RelationshipData[]; agents: AgentData[] }) {
  const livingAgents = agents.filter(a => a.isAlive && !a.isBanished);

  if (livingAgents.length === 0) {
    return <div className="flex items-center justify-center h-full text-gray-500">No living agents</div>;
  }

  if (relationships.length === 0) {
    return <div className="flex items-center justify-center h-full text-gray-500">No relationships yet</div>;
  }

  const n = livingAgents.length;
  const cx = 300, cy = 240, radius = 160;

  const positions: Record<string, { x: number; y: number }> = {};
  livingAgents.forEach((a, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    positions[a.id] = { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
  });

  return (
    <div className="w-full h-full bg-gradient-to-b from-gray-900 to-slate-900">
      <svg viewBox="0 0 600 480" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
        <defs>
          <filter id="edge-glow">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="node-grad" cx="35%" cy="30%">
            <stop offset="0%" stopColor="#374151" />
            <stop offset="100%" stopColor="#1f2937" />
          </radialGradient>
        </defs>

        {/* Relationship edges — deduplicate pairs */}
        {(() => {
          const seen = new Set<string>();
          const deduped = relationships.filter(r => {
            const key = [r.agentA, r.agentB].sort().join('|');
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          return deduped;
        })().map((r, i) => {
          const from = positions[r.agentA];
          const to = positions[r.agentB];
          if (!from || !to) return null;

          const sentiment = r.sentiment;
          const intensity = Math.abs(sentiment) / 100;
          const color = sentiment > 0
            ? `rgba(52, 211, 153, ${0.3 + intensity * 0.5})`
            : sentiment < 0
            ? `rgba(248, 113, 113, ${0.3 + intensity * 0.5})`
            : 'rgba(107, 114, 128, 0.2)';
          const width = Math.max(0.5, Math.min(4, intensity * 4));

          // Curved edge
          const midX = (from.x + to.x) / 2 + (from.y - to.y) * 0.1;
          const midY = (from.y + to.y) / 2 - (from.x - to.x) * 0.1;

          return (
            <g key={i}>
              <path
                d={`M ${from.x} ${from.y} Q ${midX} ${midY} ${to.x} ${to.y}`}
                stroke={color}
                strokeWidth={width}
                fill="none"
                filter="url(#edge-glow)"
              />
              {/* Sentiment label on hover area */}
              <title>{`${r.agentA} → ${r.agentB}: ${sentiment}`}</title>
            </g>
          );
        })}

        {/* Agent nodes */}
        {livingAgents.map(a => {
          const pos = positions[a.id];
          if (!pos) return null;

          const healthPct = (a.health ?? 100) / 100;
          const ringColor = healthPct > 0.6 ? '#34d399' : healthPct > 0.3 ? '#fbbf24' : '#ef4444';

          return (
            <g key={a.id}>
              {/* Health ring */}
              <circle
                cx={pos.x} cy={pos.y} r={26}
                fill="none"
                stroke={ringColor}
                strokeWidth="2"
                strokeDasharray={`${healthPct * 163} 163`}
                transform={`rotate(-90 ${pos.x} ${pos.y})`}
                opacity="0.6"
              />
              {/* Node */}
              <circle
                cx={pos.x} cy={pos.y} r={22}
                fill="url(#node-grad)"
                stroke="#4b5563"
                strokeWidth="1"
              />
              {/* Name */}
              <text
                x={pos.x} y={pos.y + 4}
                textAnchor="middle"
                fill="white"
                fontSize="11"
                fontFamily="Georgia, serif"
                fontWeight="600"
              >
                {a.name}
              </text>
              {/* Chieftain crown */}
              {a.isChieftain && (
                <text x={pos.x} y={pos.y - 28} textAnchor="middle" fontSize="14" role="img">
                  {'\u{1F451}'}
                </text>
              )}
            </g>
          );
        })}

        {/* Legend */}
        <g transform="translate(20, 440)">
          <line x1="0" y1="0" x2="20" y2="0" stroke="#34d399" strokeWidth="2" opacity="0.6" />
          <text x="25" y="4" fill="#9ca3af" fontSize="8">Positive</text>
          <line x1="80" y1="0" x2="100" y2="0" stroke="#f87171" strokeWidth="2" opacity="0.6" />
          <text x="105" y="4" fill="#9ca3af" fontSize="8">Negative</text>
        </g>
      </svg>
    </div>
  );
}
