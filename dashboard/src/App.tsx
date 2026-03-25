import React, { useState } from 'react';
import { useSimulation, useAgentDetail } from './hooks/useSimulation.js';
import { StatusBar } from './components/StatusBar.js';
import { AgentCards } from './components/AgentCards.js';
import { IslandMap } from './components/IslandMap.js';
import { EventTimeline } from './components/EventTimeline.js';
import { CouncilViewer } from './components/CouncilViewer.js';
import { RelationshipGraph } from './components/RelationshipGraph.js';
import { ThoughtViewer } from './components/ThoughtViewer.js';
import { CostDashboard } from './components/CostDashboard.js';
import { Conversations } from './components/Conversations.js';
import { BreakingNewsTicker } from './components/BreakingNewsTicker.js';
import { EpochSummary } from './components/EpochSummary.js';
import { ZoneViewer } from './components/ZoneViewer.js';

type CenterView = 'map' | 'relationships' | 'zones';
type BottomView = 'events' | 'council' | 'conversations' | 'thoughts' | 'summary' | 'cost';

export function App() {
  const { status, agents, locations, mapData, events, relationships, connected, error } = useSimulation();
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [centerView, setCenterView] = useState<CenterView>('map');
  const [bottomView, setBottomView] = useState<BottomView>('events');
  const [bottomExpanded, setBottomExpanded] = useState(false);
  const detail = useAgentDetail(selectedAgent);

  if (error) {
    return (
      <div className="h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-400 text-xl mb-2">Connection Error</div>
          <div className="text-gray-400">{error}</div>
          <div className="text-gray-500 mt-2">Retrying...</div>
        </div>
      </div>
    );
  }

  const bottomHeight = bottomExpanded ? 'h-96' : 'h-56';

  return (
    <div className="h-screen text-white flex flex-col overflow-hidden" style={{ background: 'linear-gradient(180deg, #070d17 0%, #0c1525 50%, #0a1220 100%)' }}>
      <StatusBar status={status} connected={connected} />
      <BreakingNewsTicker events={events} />

      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar: Agent cards */}
        <div className="w-72 overflow-y-auto glass border-r border-white/5">
          <AgentCards
            agents={agents}
            selectedAgent={selectedAgent}
            onSelectAgent={setSelectedAgent}
            detail={detail}
          />
        </div>

        {/* Center + bottom */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Center view tabs */}
          <div className="flex gap-1.5 px-4 py-2 glass border-b border-white/5">
            {([['map', 'Island Map'], ['relationships', 'Relationships'], ['zones', 'Zones']] as [CenterView, string][]).map(([view, label]) => (
              <button
                key={view}
                onClick={() => setCenterView(view)}
                className={`text-xs px-4 py-1.5 rounded-lg font-medium transition-all ${
                  centerView === view
                    ? 'bg-gradient-to-r from-emerald-600/70 to-emerald-700/70 text-white shadow-lg shadow-emerald-900/20'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Main view area */}
          <div className="flex-1 min-h-0">
            {centerView === 'map' && (
              <IslandMap
                mapData={mapData}
                locations={locations}
                selectedAgent={selectedAgent}
              />
            )}
            {centerView === 'relationships' && (
              <RelationshipGraph relationships={relationships} agents={agents} />
            )}
            {centerView === 'zones' && (
              <ZoneViewer locations={locations} />
            )}
          </div>

          {/* Bottom panel */}
          <div className={`${bottomHeight} flex flex-col glass border-t border-white/5 transition-all duration-300 rounded-t-xl`}>
            <div className="flex items-center gap-1 px-4 py-2 border-b border-white/5">
              {(['events', 'council', 'conversations', 'thoughts', 'summary', 'cost'] as BottomView[]).map(view => (
                <button
                  key={view}
                  onClick={() => setBottomView(view)}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-all capitalize relative ${
                    bottomView === view
                      ? 'bg-amber-600/20 text-amber-200 tab-active'
                      : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                  }`}
                >
                  {view}
                </button>
              ))}
              <div className="flex-1" />
              <button
                onClick={() => setBottomExpanded(!bottomExpanded)}
                className="text-xs text-gray-500 hover:text-white px-2"
              >
                {bottomExpanded ? '▼ collapse' : '▲ expand'}
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {bottomView === 'events' && <EventTimeline events={events} />}
              {bottomView === 'council' && <CouncilViewer epoch={status ? status.epoch : 0} />}
              {bottomView === 'conversations' && <Conversations />}
              {bottomView === 'thoughts' && <ThoughtViewer agents={agents} />}
              {bottomView === 'summary' && <EpochSummary currentEpoch={status?.epoch ?? 0} />}
              {bottomView === 'cost' && <CostDashboard status={status} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
