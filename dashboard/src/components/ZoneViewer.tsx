import React, { useState } from 'react';
import type { LocationData } from '../types.js';

const STRUCTURE_ICONS: Record<string, string> = {
  shelter: '\u{1F3E0}', hut: '\u{1F3E1}', storage_chest: '\u{1F4E6}',
  signal_fire: '\u{1F525}', defensive_wall: '\u{1F6E1}',
  rain_collector: '\u{1F4A7}', drying_rack: '\u{1F7EB}', kiln: '\u{1F3ED}',
};

const RESOURCE_ICONS: Record<string, string> = {
  food: '\u{1F356}', wood: '\u{1FAB5}', stone: '\u{1FAA8}',
  fiber: '\u{1F9F6}', freshwater: '\u{1F4A7}', clay: '\u{1FAB4}', herbs: '\u{1F33F}',
};

function ResourceBar({ type, quantity, maxQuantity, availability }: {
  type: string; quantity: number; maxQuantity: number; availability: string;
}) {
  const pct = maxQuantity > 0 ? Math.min(100, (quantity / maxQuantity) * 100) : 0;
  const color =
    availability === 'abundant' ? 'bg-emerald-500' :
    availability === 'moderate' ? 'bg-yellow-500' : 'bg-red-500';
  const icon = RESOURCE_ICONS[type] ?? '\u{25CF}';

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-5 text-center">{icon}</span>
      <span className="w-20 capitalize text-gray-300">{type}</span>
      <div className="flex-1 bg-white/5 rounded-full h-1.5 overflow-hidden">
        <div className={`h-1.5 rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-16 text-right tabular-nums text-gray-400">{quantity}/{maxQuantity}</span>
      <span className={`w-16 text-right text-xs ${
        availability === 'abundant' ? 'text-emerald-400' :
        availability === 'moderate' ? 'text-yellow-400' : 'text-red-400'
      }`}>{availability}</span>
    </div>
  );
}

export function ZoneViewer({ locations }: { locations: LocationData[] }) {
  const [selectedId, setSelectedId] = useState<string>(locations[0]?.id ?? '');
  const location = locations.find(l => l.id === selectedId);

  return (
    <div className="flex h-full">
      {/* Zone selector sidebar */}
      <div className="w-44 border-r border-white/5 overflow-y-auto shrink-0">
        {locations.map(loc => {
          const isSelected = loc.id === selectedId;
          const agentCount = loc.agents.length;
          const structureCount = loc.structures?.length ?? 0;
          return (
            <button
              key={loc.id}
              onClick={() => setSelectedId(loc.id)}
              className={`w-full text-left px-3 py-2.5 text-xs transition-all border-b border-white/5 ${
                isSelected
                  ? 'bg-amber-600/15 text-amber-100'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
              }`}
            >
              <div className="font-medium text-sm">{loc.name}</div>
              <div className="flex gap-2 mt-0.5 text-[10px] text-gray-500">
                {agentCount > 0 && <span>{agentCount} agent{agentCount > 1 ? 's' : ''}</span>}
                {structureCount > 0 && <span>{structureCount} structure{structureCount > 1 ? 's' : ''}</span>}
                {agentCount === 0 && structureCount === 0 && <span>empty</span>}
              </div>
            </button>
          );
        })}
      </div>

      {/* Zone detail */}
      {location ? (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Header */}
          <div>
            <h2 className="text-lg font-bold font-serif text-amber-100">{location.name}</h2>
            <p className="text-xs text-gray-400 mt-0.5">{location.description}</p>
          </div>

          {/* Resources */}
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Resources</h3>
            {location.resources.length === 0 ? (
              <p className="text-xs text-gray-500">No resources at this location.</p>
            ) : (
              <div className="space-y-1.5">
                {location.resources.map((r, i) => (
                  <ResourceBar key={i} type={r.type} quantity={r.quantity} maxQuantity={r.maxQuantity} availability={r.availability} />
                ))}
              </div>
            )}
          </div>

          {/* Structures */}
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Structures</h3>
            {(!location.structures || location.structures.length === 0) ? (
              <p className="text-xs text-gray-500">No structures built here.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {location.structures.map((s, i) => {
                  const icon = STRUCTURE_ICONS[s.type] ?? '\u{1F3D7}';
                  const props = s.properties ?? {};
                  const details: string[] = [];
                  if (props.restBonus) details.push(`+${props.restBonus} rest`);
                  if (props.weatherProtection) details.push('weather protection');
                  if (props.sharedStorage) details.push(`storage (cap ${props.capacity ?? '?'})`);
                  if (props.freshwaterGen) details.push(`+${props.freshwaterGen} water/tick`);
                  if (props.dangerReduction) details.push(`-${props.dangerReduction} danger`);
                  if (props.foodBonus) details.push(`+${props.foodBonus} food`);

                  return (
                    <div key={i} className="flex items-start gap-2 bg-white/5 rounded-lg px-3 py-2">
                      <span className="text-lg">{icon}</span>
                      <div>
                        <div className="text-sm font-medium capitalize">{s.type.replace(/_/g, ' ')}</div>
                        {details.length > 0 && (
                          <div className="text-[10px] text-gray-500 mt-0.5">{details.join(' \u{2022} ')}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Agents present */}
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Agents Present</h3>
            {location.agents.length === 0 ? (
              <p className="text-xs text-gray-500">No agents at this location.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {location.agents.map(a => (
                  <span key={a.id} className="bg-amber-900/20 border border-amber-800/20 px-3 py-1.5 rounded-lg text-sm text-amber-100">
                    {a.name}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Connections */}
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Connected To</h3>
            <div className="flex flex-wrap gap-1.5">
              {(location.connectedTo ?? []).map(id => {
                const connLoc = locations.find(l => l.id === id);
                return (
                  <button
                    key={id}
                    onClick={() => setSelectedId(id)}
                    className="text-xs bg-white/5 hover:bg-white/10 px-2.5 py-1 rounded-md text-gray-300 transition-colors"
                  >
                    {connLoc?.name ?? id}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-gray-500">Select a zone</div>
      )}
    </div>
  );
}
