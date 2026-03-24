import React, { useState, useRef, useEffect } from 'react';
import type { EventData } from '../types.js';

const TYPE_ICONS: Record<string, string> = {
  gather: '\u{1F33F}',
  rest: '\u{1F4A4}',
  move: '\u{1F9ED}',
  eat: '\u{1F356}',
  craft: '\u{1F528}',
  death: '\u{1F480}',
  speech: '\u{1F4AC}',
  whisper: '\u{1F90B}',
  internal_monologue: '\u{1F4AD}',
  banishment: '\u{26D4}',
  council_call_to_order: '\u{1F3DB}',
  council_adjourned: '\u{1F3DB}',
  motion_resolved: '\u{1F5F3}',
  epoch_boundary: '\u{1F305}',
  tropical_storm: '\u{26C8}',
  resource_discovery: '\u{2728}',
  illness_outbreak: '\u{1F912}',
  explore: '\u{1F50D}',
  election_result: '\u{1F451}',
  no_confidence_passed: '\u{1F4A5}',
};

const TYPE_COLORS: Record<string, string> = {
  gather: 'text-green-400',
  rest: 'text-blue-300',
  move: 'text-yellow-400',
  eat: 'text-orange-400',
  craft: 'text-purple-400',
  death: 'text-red-500',
  speech: 'text-cyan-400',
  whisper: 'text-cyan-200',
  internal_monologue: 'text-gray-400 italic',
  banishment: 'text-red-400',
  council_call_to_order: 'text-amber-400',
  council_adjourned: 'text-amber-400',
  motion_resolved: 'text-amber-300',
  epoch_boundary: 'text-indigo-400',
  explore: 'text-teal-400',
  election_result: 'text-yellow-300',
};

function summarizeEvent(event: EventData): string {
  const d = event.data;
  if (!d) return event.eventType;
  try {
    const data = typeof d === 'string' ? JSON.parse(d) : d;
    switch (event.eventType) {
      case 'gather': return `gathered ${data.amount} ${data.resource}`;
      case 'move': return `moved to ${data.to}`;
      case 'eat': return `ate ${data.item}, hunger -${data.hungerReduction}`;
      case 'rest': return `rested, +${data.energyRecovered} energy`;
      case 'craft': return `crafted ${data.recipe}`;
      case 'death': return `died: ${data.cause}`;
      case 'speech': return `"${data.message}"`;
      case 'internal_monologue': return `"${data.thought}"`;
      case 'motion_resolved': return `${data.type} motion ${data.passed ? 'PASSED' : 'FAILED'} (${data.ayes}/${data.nays}/${data.abstentions})`;
      case 'epoch_boundary': return `Epoch ${data.newEpoch} begins`;
      case 'election_result': return `elected as new Chieftain`;
      case 'explore': return data.found || 'explored area';
      default: return JSON.stringify(data).slice(0, 80);
    }
  } catch {
    return String(d).slice(0, 80);
  }
}

export function EventTimeline({ events }: { events: EventData[] }) {
  const [filter, setFilter] = useState('');
  const [pinned, setPinned] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const filtered = filter
    ? events.filter(e => e.eventType.includes(filter) || e.agentId?.includes(filter))
    : events;

  useEffect(() => {
    if (pinned && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filtered.length, pinned]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 flex gap-2 items-center">
        <input
          type="text"
          placeholder="Filter by type or agent..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="flex-1 bg-gray-700/50 text-white text-xs px-3 py-1.5 rounded-md border border-gray-600/30 focus:border-blue-500/50 focus:outline-none"
        />
        <button
          onClick={() => setPinned(!pinned)}
          className={`text-xs px-2 py-1 rounded ${pinned ? 'text-blue-400' : 'text-gray-500'}`}
        >
          {pinned ? 'Auto-scroll ON' : 'Auto-scroll OFF'}
        </button>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 space-y-0.5 text-xs font-mono">
        {filtered.map(event => {
          const icon = TYPE_ICONS[event.eventType] ?? '\u{25CF}';
          const color = TYPE_COLORS[event.eventType] ?? 'text-gray-300';
          return (
            <div key={event.id} className="flex items-start gap-2 py-0.5 hover:bg-gray-700/20 rounded px-1">
              <span className="text-gray-600 w-6 shrink-0 text-right tabular-nums">
                {event.tick}
              </span>
              <span className="w-4 shrink-0 text-center">{icon}</span>
              {event.agentId && (
                <span className="text-emerald-400 w-16 shrink-0 truncate font-semibold">
                  {event.agentId}
                </span>
              )}
              {!event.agentId && <span className="w-16 shrink-0" />}
              <span className={`${color} flex-1`}>
                {summarizeEvent(event)}
              </span>
            </div>
          );
        })}
        {filtered.length === 0 && <div className="text-gray-500 py-4 text-center">No events</div>}
      </div>
    </div>
  );
}
