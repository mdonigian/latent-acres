import React, { useState, useEffect } from 'react';

interface CouncilData {
  epoch: number;
  motions: {
    id: number; type: string; text: string;
    proposedBy: string; secondedBy: string | null;
    status: string; ayes: number; nays: number; abstentions: number;
  }[];
  transcript?: string[];
  speeches?: { agentId: string; agentName: string; type: string; message?: string; motionId?: number; round?: number }[];
}

export function CouncilViewer({ epoch: currentEpoch }: { epoch: number }) {
  const [epoch, setEpoch] = useState(currentEpoch);
  const [council, setCouncil] = useState<CouncilData | null>(null);
  const [revealVotes, setRevealVotes] = useState(false);
  const [votes, setVotes] = useState<Record<number, { voter: string; vote: string }[]>>({});

  useEffect(() => { setEpoch(currentEpoch); }, [currentEpoch]);

  useEffect(() => {
    fetch(`/api/council/${epoch}`).then(r => r.json()).then(setCouncil).catch(() => setCouncil(null));
    setRevealVotes(false);
    setVotes({});
  }, [epoch]);

  const handleRevealVotes = async () => {
    if (revealVotes) { setRevealVotes(false); return; }
    try {
      const data = await fetch(`/api/council/${epoch}/votes`).then(r => r.json());
      const voteMap: Record<number, { voter: string; vote: string }[]> = {};
      for (const m of data) { voteMap[m.motionId] = m.votes; }
      setVotes(voteMap);
      setRevealVotes(true);
    } catch {}
  };

  const hasMotions = council && council.motions.length > 0;
  const hasTranscript = council?.transcript && council.transcript.length > 0;

  return (
    <div className="p-4 space-y-3 text-sm overflow-y-auto">
      <div className="flex items-center gap-3">
        <button
          onClick={() => setEpoch(Math.max(0, epoch - 1))}
          disabled={epoch <= 0}
          className="text-xs px-2 py-1 bg-gray-700 rounded hover:bg-gray-600 disabled:opacity-30"
        >{'\u{25C0}'}</button>
        <h3 className="font-bold font-serif text-amber-100">Council - Epoch {epoch}</h3>
        <button
          onClick={() => setEpoch(epoch + 1)}
          disabled={epoch >= currentEpoch}
          className="text-xs px-2 py-1 bg-gray-700 rounded hover:bg-gray-600 disabled:opacity-30"
        >{'\u{25B6}'}</button>
        <div className="flex-1" />
        {hasMotions && (
          <button onClick={handleRevealVotes} className="text-xs px-2 py-1 bg-gray-700 rounded hover:bg-gray-600">
            {revealVotes ? 'Hide Votes' : 'Reveal Votes'}
          </button>
        )}
      </div>

      {!hasMotions && !hasTranscript && <div className="text-gray-500 text-xs">No council session recorded for this epoch.</div>}

      {/* Transcript / Debate */}
      {hasTranscript && (
        <div className="space-y-1">
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Debate Transcript</h4>
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {council!.transcript!.map((line, i) => {
              const isHeader = line.startsWith('---');
              const isSystem = line.startsWith('The Chieftain') || line.startsWith('Motion #') || line.includes('PASSED') || line.includes('FAILED') || line.includes('dies');
              const speechMatch = line.match(/^(.+?):\s*"(.+)"$/);

              if (isHeader) {
                return <div key={i} className="text-amber-600/60 text-[10px] font-semibold uppercase tracking-wider pt-2">{line.replace(/---/g, '').trim()}</div>;
              }
              if (isSystem) {
                return <div key={i} className="text-amber-300/70 text-xs italic">{line}</div>;
              }
              if (speechMatch) {
                return (
                  <div key={i} className="flex gap-2 text-xs py-0.5">
                    <span className="text-emerald-400 font-semibold shrink-0">{speechMatch[1]}</span>
                    <span className="text-gray-300 font-serif italic">{'\u{201C}'}{speechMatch[2]}{'\u{201D}'}</span>
                  </div>
                );
              }
              return <div key={i} className="text-gray-400 text-xs">{line}</div>;
            })}
          </div>
        </div>
      )}

      {/* Motions */}
      {hasMotions && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Motions</h4>
          {council!.motions.map(m => {
            const statusColor =
              m.status === 'passed' ? 'bg-green-900/50 text-green-300 border-green-700/30' :
              m.status === 'failed' ? 'bg-red-900/50 text-red-300 border-red-700/30' :
              m.status === 'died' ? 'bg-gray-800 text-gray-500 border-gray-700/30' :
              'bg-amber-900/30 text-amber-300 border-amber-700/30';

            return (
              <div key={m.id} className={`p-3 rounded-lg border ${statusColor}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs px-1.5 py-0.5 rounded font-medium uppercase">{m.status}</span>
                  <span className="text-xs text-gray-400">[{m.type}]</span>
                </div>
                <p className="font-serif">{m.text}</p>
                <div className="text-xs text-gray-400 mt-1.5">
                  Proposed by: <span className="text-white">{m.proposedBy}</span>
                  {m.secondedBy && <> | Seconded by: <span className="text-white">{m.secondedBy}</span></>}
                </div>
                {(m.ayes > 0 || m.nays > 0 || m.abstentions > 0) && (
                  <div className="text-xs mt-1 flex gap-3">
                    <span className="text-green-400">Ayes: {m.ayes}</span>
                    <span className="text-red-400">Nays: {m.nays}</span>
                    <span className="text-gray-400">Abstain: {m.abstentions}</span>
                  </div>
                )}
                {revealVotes && votes[m.id] && (
                  <div className="mt-2 pt-2 border-t border-gray-700/30 text-xs flex flex-wrap gap-2">
                    {votes[m.id].map((v, i) => (
                      <span key={i} className="bg-gray-800/50 px-2 py-0.5 rounded">
                        {v.voter}: <span className={v.vote === 'aye' ? 'text-green-400' : v.vote === 'nay' ? 'text-red-400' : 'text-gray-500'}>{v.vote}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
