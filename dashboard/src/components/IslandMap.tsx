import React, { useState, useRef } from 'react';
import type { MapData, LocationData } from '../types.js';

const TILE_W = 65;
const TILE_H = 89;
const TILE_SCALE = 1.1;
const TW = TILE_W * TILE_SCALE;
const TH = TILE_H * TILE_SCALE;

// Card dimensions (tile centered inside)
const CARD_W = 130;
const CARD_H = 160;
const CARD_R = 10;

interface LocMeta {
  x: number; y: number;
  tile: string;
  overlay?: string;
  label: string;
  terrain: string;
}

// Generous spacing — cards are 130x160, positions are card top-left
const LOCS: Record<string, LocMeta> = {
  the_summit:     { x: 400, y: 10,  tile: 'summit',      overlay: 'rock',          label: 'The Summit',       terrain: 'Peak, rare stone' },
  dense_jungle:   { x: 60,  y: 210, tile: 'jungle_base',  overlay: 'tree_tall',    label: 'Dense Jungle',     terrain: 'Thick canopy, vines' },
  waterfall:      { x: 370, y: 220, tile: 'waterfall',                              label: 'Waterfall',        terrain: 'Misty cascade' },
  rocky_ridge:    { x: 680, y: 210, tile: 'ridge',        overlay: 'rock_moss',    label: 'Rocky Ridge',      terrain: 'Exposed stone, wind' },
  the_clearing:   { x: 200, y: 420, tile: 'clearing',     overlay: 'flower',       label: 'The Clearing',     terrain: 'Central hub, firepit' },
  tidal_pools:    { x: 560, y: 420, tile: 'tidal',        overlay: 'pebbles_stone', label: 'Tidal Pools',     terrain: 'Tide-fed pools' },
  the_beach:      { x: 60,  y: 630, tile: 'beach',        overlay: 'hill_sand',    label: 'The Beach',        terrain: 'Sandy shores' },
  mangrove_swamp: { x: 420, y: 630, tile: 'swamp',        overlay: 'bush_dirt',    label: 'Mangrove Swamp',   terrain: 'Murky roots, humid' },
};

const RES_ICONS: Record<string, string> = {
  food: '\u{1F356}', wood: '\u{1FAB5}', stone: '\u{1FAA8}',
  fiber: '\u{1F9F6}', freshwater: '\u{1F4A7}',
};

function LocationPopover({
  location, meta, containerRef, onClose,
}: {
  location: LocationData; meta: LocMeta;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
}) {
  const container = containerRef.current;
  if (!container) return null;
  const svg = container.querySelector('svg');
  if (!svg) return null;

  const rect = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  const scale = Math.min(rect.width / vb.width, rect.height / vb.height);
  const ox = rect.left + (rect.width - vb.width * scale) / 2;
  const oy = rect.top + (rect.height - vb.height * scale) / 2;

  const sx = ox + (meta.x + CARD_W / 2) * scale;
  const sy = oy + (meta.y + CARD_H / 2) * scale;

  const popLeft = sx + 30 > window.innerWidth - 260 ? sx - 260 : sx + 30;
  const popTop = Math.max(8, Math.min(window.innerHeight - 360, sy - 80));

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        className="absolute bg-gray-900/95 border border-amber-800/30 rounded-xl p-4 text-xs shadow-2xl backdrop-blur-md w-60"
        style={{ left: popLeft, top: popTop }}
        onClick={e => e.stopPropagation()}
      >
        <div className="font-bold text-base text-amber-100 mb-0.5 font-serif">{location.name}</div>
        <div className="text-amber-700/80 italic text-[10px] mb-2">{meta.terrain}</div>
        <div className="text-gray-400 text-[11px] mb-3 leading-relaxed">{location.description}</div>

        <div className="mb-3">
          <div className="text-amber-600 font-semibold mb-1.5 uppercase text-[9px] tracking-wider">Resources</div>
          {location.resources.length === 0 ? (
            <div className="text-gray-500">None</div>
          ) : (
            <div className="space-y-1">
              {location.resources.map((r, i) => {
                const icon = RES_ICONS[r.type] ?? '\u{25CF}';
                const color =
                  r.availability === 'abundant' ? 'text-emerald-400' :
                  r.availability === 'moderate' ? 'text-yellow-400' : 'text-red-400';
                return (
                  <div key={i} className="flex items-center gap-1.5">
                    <span>{icon}</span>
                    <span className="capitalize text-gray-300">{r.type}</span>
                    <span className={`ml-auto ${color} text-[10px]`}>{r.availability}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {location.agents.length > 0 && (
          <div>
            <div className="text-amber-600 font-semibold mb-1.5 uppercase text-[9px] tracking-wider">Present</div>
            <div className="flex flex-wrap gap-1">
              {location.agents.map(a => (
                <span key={a.id} className="bg-amber-900/30 border border-amber-800/20 px-2 py-0.5 rounded-md text-[11px] text-amber-100">{a.name}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function IslandMap({
  mapData, locations, selectedAgent,
}: {
  mapData: MapData | null;
  locations: LocationData[];
  selectedAgent: string | null;
}) {
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  if (!mapData) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-900 text-gray-500">
        <div className="text-center">
          <div className="text-3xl mb-2">{'\u{1F3DD}'}</div>
          <div className="font-serif">Loading island...</div>
        </div>
      </div>
    );
  }

  const selectedLoc = selectedLocation ? locations.find(l => l.id === selectedLocation) : null;
  const selectedMeta = selectedLocation ? LOCS[selectedLocation] : null;

  const VB_W = 920;
  const VB_H = 850;

  return (
    <div
      ref={containerRef}
      className="w-full h-full overflow-hidden relative"
      style={{ background: 'linear-gradient(170deg, #0b1a2a 0%, #0f2540 50%, #0a2040 100%)' }}
    >
      <div className="absolute top-3 left-4 z-20 select-none">
        <span className="text-amber-700/20 text-[10px] font-serif tracking-[0.35em] uppercase">Latent Acres</span>
      </div>

      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
        <defs>
          <filter id="card-shadow">
            <feDropShadow dx="1" dy="3" stdDeviation="5" floodColor="#000" floodOpacity="0.5" />
          </filter>
          <filter id="glow-blue">
            <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="#3b82f6" floodOpacity="0.5" />
          </filter>
          <filter id="glow-amber">
            <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="#d97706" floodOpacity="0.4" />
          </filter>
        </defs>

        {/* Paths between location cards */}
        {mapData.edges.map((edge, i) => {
          const from = LOCS[edge.from];
          const to = LOCS[edge.to];
          if (!from || !to) return null;
          const fx = from.x + CARD_W / 2, fy = from.y + CARD_H / 2;
          const tx = to.x + CARD_W / 2, ty = to.y + CARD_H / 2;
          const mx = (fx + tx) / 2 + Math.sin(i * 1.7) * 15;
          const my = (fy + ty) / 2 + Math.cos(i * 2.3) * 12;
          return (
            <path
              key={i}
              d={`M${fx} ${fy} Q${mx} ${my} ${tx} ${ty}`}
              stroke="#c4a86a" strokeWidth="1.5" fill="none" opacity="0.12"
              strokeDasharray="6 8" strokeLinecap="round"
            />
          );
        })}

        {/* Location cards */}
        {Object.entries(LOCS).map(([id, meta]) => {
          const loc = locations.find(l => l.id === id);
          const agents = loc?.agents ?? [];
          const hasSelected = agents.some(a => a.id === selectedAgent);
          const isLocSelected = selectedLocation === id;
          const highlight = hasSelected || isLocSelected;

          // Tile position centered in card
          const tileX = meta.x + (CARD_W - TW) / 2;
          const tileY = meta.y + 22;

          return (
            <g
              key={id}
              style={{ cursor: 'pointer' }}
              onClick={() => setSelectedLocation(isLocSelected ? null : id)}
              filter="url(#card-shadow)"
            >
              {/* Card background */}
              <rect
                x={meta.x} y={meta.y}
                width={CARD_W} height={CARD_H}
                rx={CARD_R} ry={CARD_R}
                fill="#111b2a"
                stroke={highlight ? (hasSelected ? '#3b82f6' : '#d97706') : '#1e3048'}
                strokeWidth={highlight ? 2 : 1}
                opacity="0.9"
                filter={highlight ? (hasSelected ? 'url(#glow-blue)' : 'url(#glow-amber)') : undefined}
              />

              {/* Title at top of card */}
              <text
                x={meta.x + CARD_W / 2} y={meta.y + 15}
                textAnchor="middle"
                fill="#e8d5a3"
                fontSize="10"
                fontFamily="Georgia, serif"
                fontWeight="700"
                style={{ pointerEvents: 'none' }}
              >
                {meta.label}
              </text>

              {/* Hex tile image */}
              <image
                href={`/tiles/map/${meta.tile}.png`}
                x={tileX} y={tileY}
                width={TW} height={TH}
              />

              {/* Small overlay detail */}
              {meta.overlay && (
                <image
                  href={`/tiles/map/${meta.overlay}.png`}
                  x={tileX + TW * 0.33}
                  y={tileY + TH * 0.1}
                  width={TW * 0.34}
                  height={TH * 0.42}
                  style={{ pointerEvents: 'none' }}
                />
              )}

              {/* Terrain subtitle at bottom of card */}
              <text
                x={meta.x + CARD_W / 2} y={meta.y + CARD_H - 8}
                textAnchor="middle"
                fill="#6b7a8a"
                fontSize="7"
                fontFamily="Georgia, serif"
                fontStyle="italic"
                style={{ pointerEvents: 'none' }}
              >
                {meta.terrain}
              </text>

              {/* Resource dots along bottom edge inside card */}
              {loc && loc.resources.length > 0 && (
                <g style={{ pointerEvents: 'none' }}>
                  {loc.resources.slice(0, 5).map((r, ri) => {
                    const count = Math.min(loc!.resources.length, 5);
                    const rx = meta.x + CARD_W / 2 - ((count - 1) * 9) / 2 + ri * 9;
                    const ry = meta.y + CARD_H - 22;
                    const c =
                      r.availability === 'abundant' ? '#34d399' :
                      r.availability === 'moderate' ? '#fbbf24' : '#ef4444';
                    return (
                      <g key={ri}>
                        <circle cx={rx} cy={ry} r="3" fill="black" opacity="0.2" />
                        <circle cx={rx} cy={ry - 0.5} r="2.5" fill={c} opacity="0.9" />
                      </g>
                    );
                  })}
                </g>
              )}
            </g>
          );
        })}

        {/* Agent pips rendered on top of all cards so they're never clipped */}
        {Object.entries(LOCS).map(([id, meta]) => {
          const loc = locations.find(l => l.id === id);
          const agents = loc?.agents ?? [];
          if (agents.length === 0) return null;

          return (
            <g key={`agents-${id}`} style={{ pointerEvents: 'none' }}>
              {agents.map((agent, idx) => {
                const ax = meta.x + CARD_W / 2 - ((agents.length - 1) * 14) / 2 + idx * 14;
                const ay = meta.y + CARD_H + 10;
                const isSel = agent.id === selectedAgent;
                return (
                  <g key={agent.id}>
                    <circle cx={ax} cy={ay + 1} r={7} fill="black" opacity="0.3" />
                    <circle cx={ax} cy={ay} r={7}
                      fill={isSel ? '#3b82f6' : '#111b2a'}
                      stroke={isSel ? '#93c5fd' : '#c4a86a'}
                      strokeWidth={isSel ? 2 : 1}
                    />
                    <text x={ax} y={ay + 3.5} textAnchor="middle" fill="white" fontSize="8" fontWeight="bold" fontFamily="monospace">
                      {agent.name?.[0] ?? '?'}
                    </text>
                  </g>
                );
              })}
              <text
                x={meta.x + CARD_W / 2} y={meta.y + CARD_H + 26}
                textAnchor="middle" fill="#c4a86a" fontSize="8" opacity="0.5"
                fontFamily="Georgia, serif"
              >
                {agents.map(a => a.name).join(' \u{2022} ')}
              </text>
            </g>
          );
        })}

        {/* Compass rose */}
        <g transform={`translate(${VB_W - 40}, ${VB_H - 40})`} opacity="0.12">
          <line x1="0" y1="-14" x2="0" y2="14" stroke="#c4a86a" strokeWidth="1" />
          <line x1="-14" y1="0" x2="14" y2="0" stroke="#c4a86a" strokeWidth="1" />
          <polygon points="0,-16 -3,-8 3,-8" fill="#c4a86a" />
          <text x="0" y="-19" textAnchor="middle" fill="#c4a86a" fontSize="7" fontFamily="Georgia, serif">N</text>
        </g>
      </svg>

      {selectedLoc && selectedMeta && (
        <LocationPopover
          location={selectedLoc}
          meta={selectedMeta}
          containerRef={containerRef}
          onClose={() => setSelectedLocation(null)}
        />
      )}
    </div>
  );
}
