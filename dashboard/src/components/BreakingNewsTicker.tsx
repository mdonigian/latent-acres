import React, { useState, useEffect } from 'react';
import type { EventData } from '../types.js';

interface TickerItem {
  id: number;
  icon: string;
  text: string;
  expiresAt: number;
}

function buildTickerItems(events: EventData[]): TickerItem[] {
  const items: TickerItem[] = [];
  const now = Date.now();
  for (const e of events) {
    if (e.eventType === 'death') {
      const name = (e.data?.agentName as string) ?? e.agentId ?? 'unknown';
      const cause = (e.data?.cause as string) ?? 'unknown cause';
      items.push({ id: e.id, icon: '\u{1F480}', text: `${name} has died — ${cause}`, expiresAt: now + 30000 });
    } else if (e.eventType === 'banishment') {
      const name = (e.data?.agentName as string) ?? e.agentId ?? 'unknown';
      items.push({ id: e.id, icon: '\u{26D4}', text: `${name} has been banished`, expiresAt: now + 30000 });
    } else if (e.eventType === 'murder') {
      items.push({ id: e.id, icon: '\u{1F5E1}', text: `${e.data?.attacker} killed ${e.data?.victim}!`, expiresAt: now + 60000 });
    } else if (e.eventType === 'attack_failed') {
      items.push({ id: e.id, icon: '\u{2694}', text: `${e.data?.attacker} tried to kill ${e.data?.victim} and failed!`, expiresAt: now + 30000 });
    } else if (e.eventType === 'motion_resolved' && e.data?.passed) {
      items.push({ id: e.id, icon: '\u{1F5F3}', text: `Motion passed: ${String(e.data?.type ?? '')}`, expiresAt: now + 30000 });
    }
  }
  return items;
}

export function BreakingNewsTicker({ events }: { events: EventData[] }) {
  const [items, setItems] = useState<TickerItem[]>([]);

  useEffect(() => {
    const newItems = buildTickerItems(events);
    if (newItems.length === 0) return;
    setItems(prev => {
      const existingIds = new Set(prev.map(i => i.id));
      const fresh = newItems.filter(i => !existingIds.has(i.id));
      if (fresh.length === 0) return prev;
      return [...prev, ...fresh];
    });
  }, [events]);

  // Auto-dismiss expired items
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setItems(prev => prev.filter(i => i.expiresAt > now));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  if (items.length === 0) return null;

  return (
    <div
      data-testid="breaking-news-ticker"
      className="w-full bg-amber-950/80 border-b border-amber-800/40 backdrop-blur-sm overflow-hidden"
      style={{ height: '28px' }}
    >
      <div className="flex items-center h-full px-3 gap-2">
        <span className="text-amber-400 text-[10px] font-bold uppercase tracking-widest shrink-0">Breaking</span>
        <div className="h-3 w-px bg-amber-700/50" />
        <div className="flex-1 overflow-hidden">
          <div className="flex gap-6 ticker-scroll">
            {items.map(item => (
              <span key={item.id} className="text-amber-200 text-xs whitespace-nowrap flex items-center gap-1.5">
                <span>{item.icon}</span>
                <span>{item.text}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
