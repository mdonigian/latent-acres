import React, { useEffect, useState } from 'react';

interface Props {
  epoch: number;
  onDismiss: () => void;
}

export function EpochRecapModal({ epoch, onDismiss }: Props) {
  const [recap, setRecap] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/recap/${epoch}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setRecap(d?.recap ?? null))
      .catch(() => setRecap(null))
      .finally(() => setLoading(false));
  }, [epoch]);

  return (
    <div
      data-testid="epoch-recap-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm"
      onClick={onDismiss}
    >
      <div
        className="bg-gray-900/95 border border-amber-800/30 rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="text-center mb-4">
          <div className="text-amber-400/60 text-[11px] uppercase tracking-[0.3em] font-semibold mb-1">Previously on</div>
          <h2 className="text-2xl font-bold text-amber-100 font-serif tracking-wide">Latent Acres</h2>
          <div className="text-amber-700/50 text-xs mt-0.5">Epoch {epoch} Recap</div>
        </div>

        <div className="border-t border-amber-900/30 pt-4 min-h-[80px]">
          {loading ? (
            <p className="text-gray-500 text-sm text-center italic">Loading recap...</p>
          ) : recap ? (
            <p className="text-gray-200 text-sm leading-relaxed font-serif">{recap}</p>
          ) : (
            <p className="text-gray-500 text-sm text-center italic">Recap not available.</p>
          )}
        </div>

        <div className="mt-6 text-center">
          <button
            onClick={onDismiss}
            className="px-6 py-2 bg-amber-800/30 hover:bg-amber-800/50 border border-amber-700/30 text-amber-200 text-sm rounded-lg transition-colors"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
