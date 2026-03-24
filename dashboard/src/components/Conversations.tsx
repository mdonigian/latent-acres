import React, { useState, useEffect, useRef } from 'react';

interface ConversationMessage {
  id: number;
  tick: number;
  epoch: number;
  from: string;
  message: string;
  target: string;
  isWhisper: boolean;
  location: string;
}

export function Conversations() {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [filter, setFilter] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = () => {
      fetch('/api/conversations?limit=200')
        .then(r => r.json())
        .then(setMessages)
        .catch(() => {});
    };
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  const filtered = filter
    ? messages.filter(m =>
        m.from.toLowerCase().includes(filter.toLowerCase()) ||
        m.target.toLowerCase().includes(filter.toLowerCase()) ||
        m.message.toLowerCase().includes(filter.toLowerCase())
      )
    : messages;

  if (messages.length === 0) {
    return <div className="p-4 text-gray-500 text-sm">No conversations yet. Agents haven't spoken to each other.</div>;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2">
        <input
          type="text"
          placeholder="Filter by agent or keyword..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="w-full bg-gray-700/50 text-white text-xs px-3 py-1.5 rounded-md border border-gray-600/30 focus:border-blue-500/50 focus:outline-none"
        />
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 space-y-1.5 text-sm">
        {filtered.map(msg => (
          <div
            key={msg.id}
            className={`flex gap-2 py-1 px-2 rounded ${msg.isWhisper ? 'bg-purple-900/10 border-l-2 border-purple-500/30' : ''}`}
          >
            <span className="text-gray-600 text-xs w-6 shrink-0 text-right tabular-nums pt-0.5">{msg.tick}</span>
            <div className="min-w-0">
              <span className="font-semibold text-emerald-400 text-xs">{msg.from}</span>
              {msg.isWhisper && (
                <span className="text-purple-400 text-xs"> {'\u{2192}'} {msg.target} <span className="text-purple-600">(whisper)</span></span>
              )}
              {!msg.isWhisper && msg.target !== 'all' && (
                <span className="text-gray-400 text-xs"> {'\u{2192}'} {msg.target}</span>
              )}
              <p className="text-gray-300 text-xs mt-0.5 font-serif italic">{'\u{201C}'}{msg.message}{'\u{201D}'}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
