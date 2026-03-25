import React, { useState, useEffect } from 'react';
import Markdown from 'react-markdown';

export function EpochSummary({ currentEpoch }: { currentEpoch: number }) {
  const [epoch, setEpoch] = useState(Math.max(0, currentEpoch - 1));
  const [recap, setRecap] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/recap/${epoch}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setRecap(d?.recap ?? null))
      .catch(() => setRecap(null))
      .finally(() => setLoading(false));
  }, [epoch]);

  return (
    <div className="p-4 space-y-3 text-sm">
      <div className="flex items-center gap-3">
        <button
          onClick={() => setEpoch(Math.max(0, epoch - 1))}
          disabled={epoch <= 0}
          className="text-xs px-2 py-1 bg-gray-700 rounded hover:bg-gray-600 disabled:opacity-30"
        >
          {'\u{25C0}'}
        </button>
        <h3 className="font-bold font-serif text-amber-100">Epoch {epoch} Summary</h3>
        <button
          onClick={() => setEpoch(epoch + 1)}
          disabled={epoch >= currentEpoch}
          className="text-xs px-2 py-1 bg-gray-700 rounded hover:bg-gray-600 disabled:opacity-30"
        >
          {'\u{25B6}'}
        </button>
      </div>

      {loading ? (
        <p className="text-gray-500 italic">Loading...</p>
      ) : recap ? (
        <div className="text-gray-300 leading-relaxed font-serif prose prose-invert prose-sm max-w-none">
          <Markdown>{recap}</Markdown>
        </div>
      ) : (
        <p className="text-gray-500 italic">No summary available for this epoch yet.</p>
      )}
    </div>
  );
}
