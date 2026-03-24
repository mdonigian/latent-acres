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

type CenterView = 'map' | 'relationships';
type BottomView = 'events' | 'council' | 'conversations' | 'thoughts' | 'cost';

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
    <div className="h-screen bg-gray-900 text-white flex flex-col overflow-hidden">
      <StatusBar status={status} connected={connected} />

      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar: Agent cards */}
        <div className="w-72 border-r border-gray-700/50 overflow-y-auto bg-gray-900/80">
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
          <div className="flex gap-1 px-3 py-2 border-b border-gray-700/50 bg-gray-800/30">
            <button
              onClick={() => setCenterView('map')}
              className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${centerView === 'map' ? 'bg-emerald-600/80 text-white' : 'bg-gray-700/40 text-gray-400 hover:text-white'}`}
            >
              Island Map
            </button>
            <button
              onClick={() => setCenterView('relationships')}
              className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${centerView === 'relationships' ? 'bg-emerald-600/80 text-white' : 'bg-gray-700/40 text-gray-400 hover:text-white'}`}
            >
              Relationships
            </button>
          </div>

          {/* Main view area */}
          <div className="flex-1 min-h-0">
            {centerView === 'map' ? (
              <IslandMap mapData={mapData} locations={locations} selectedAgent={selectedAgent} />
            ) : (
              <RelationshipGraph relationships={relationships} agents={agents} />
            )}
          </div>

          {/* Bottom panel */}
          <div className={`${bottomHeight} border-t border-gray-700/50 flex flex-col bg-gray-800/20 transition-all`}>
            <div className="flex items-center gap-1 px-3 py-1.5 border-b border-gray-700/50 bg-gray-800/30">
              {(['events', 'council', 'conversations', 'thoughts', 'cost'] as BottomView[]).map(view => (
                <button
                  key={view}
                  onClick={() => setBottomView(view)}
                  className={`text-xs px-3 py-1 rounded-md font-medium transition-colors capitalize ${bottomView === view ? 'bg-blue-600/80 text-white' : 'bg-gray-700/40 text-gray-400 hover:text-white'}`}
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
              {bottomView === 'council' && <CouncilViewer epoch={status ? Math.max(0, status.epoch - 1) : 0} />}
              {bottomView === 'conversations' && <Conversations />}
              {bottomView === 'thoughts' && <ThoughtViewer agents={agents} />}
              {bottomView === 'cost' && <CostDashboard status={status} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
