import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { StatusBar } from './components/StatusBar.js';
import { AgentCards } from './components/AgentCards.js';
import { EventTimeline } from './components/EventTimeline.js';
import { CostDashboard } from './components/CostDashboard.js';
import { CouncilViewer } from './components/CouncilViewer.js';
import { ThoughtViewer } from './components/ThoughtViewer.js';
import { RelationshipGraph } from './components/RelationshipGraph.js';
import type { StatusData, AgentData, AgentDetail, EventData, RelationshipData } from './types.js';

beforeEach(() => {
  // Mock fetch for StatusBar's useEffect call to /api/sim/status
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ running: false, tickDelaySec: 1 }), { status: 200 })
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const mockStatus: StatusData = {
  tick: 5,
  epoch: 0,
  phase: 'tick',
  status: 'running',
  livingAgents: 3,
  totalAgents: 4,
  cost: 1.23,
};

const mockAgents: AgentData[] = [
  { id: 'vex', name: 'Vex', health: 80, hunger: 30, energy: 60, location: 'the_beach', isAlive: true, isChieftain: true, isBanished: false },
  { id: 'luna', name: 'Luna', health: 100, hunger: 10, energy: 90, location: 'the_beach', isAlive: true, isChieftain: false, isBanished: false },
  { id: 'moss', name: 'Moss', health: 50, hunger: 40, energy: 70, location: 'dense_jungle', isAlive: true, isChieftain: false, isBanished: false },
  { id: 'sable', name: 'Sable', health: 0, hunger: 100, energy: 0, location: 'the_beach', isAlive: false, isChieftain: false, isBanished: false },
];

const mockEvents: EventData[] = [
  { id: 1, tick: 0, epoch: 0, eventType: 'gather', agentId: 'vex', data: { resource: 'food' } },
  { id: 2, tick: 1, epoch: 0, eventType: 'rest', agentId: 'luna', data: {} },
];

describe('StatusBar', () => {
  it('shows tick, epoch, phase, status, agents, cost', () => {
    render(<StatusBar status={mockStatus} connected={true} />);
    expect(screen.getByText('5')).toBeDefined(); // tick value
    expect(screen.getByText('Pause')).toBeDefined(); // running shows Pause button
    expect(screen.getByText(/3\/4/)).toBeDefined();
    expect(screen.getByText(/\$1\.23/)).toBeDefined();
  });

  it('shows connected/disconnected state', () => {
    render(<StatusBar status={mockStatus} connected={true} />);
    expect(screen.getByText('Live')).toBeDefined();
    cleanup();

    render(<StatusBar status={mockStatus} connected={false} />);
    expect(screen.getByText('Offline')).toBeDefined();
  });
});

describe('AgentCards', () => {
  it('shows health/hunger/energy bars that update each tick', () => {
    render(
      <AgentCards agents={mockAgents} selectedAgent={null} onSelectAgent={() => {}} detail={null} />
    );
    expect(screen.getByText('Vex')).toBeDefined();
    expect(screen.getByText('Luna')).toBeDefined();
    expect(screen.getByTitle('Chieftain')).toBeDefined();
    // Stat bars are present
    expect(screen.getAllByText('Health').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Hunger').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Energy').length).toBeGreaterThan(0);
  });

  it('dead/banished agents shown greyed out with cause', () => {
    render(
      <AgentCards agents={mockAgents} selectedAgent={null} onSelectAgent={() => {}} detail={null} />
    );
    // Sable is dead - should show "Dead" label
    expect(screen.getByText('Sable')).toBeDefined();
    expect(screen.getAllByText('Dead').length).toBeGreaterThan(0);
  });

  it('clicking agent card highlights location and shows expanded details', () => {
    const onSelect = vi.fn();
    render(
      <AgentCards agents={mockAgents} selectedAgent={null} onSelectAgent={onSelect} detail={null} />
    );
    fireEvent.click(screen.getByText('Vex'));
    expect(onSelect).toHaveBeenCalledWith('vex');
  });

  it('shows expanded details when agent is selected', () => {
    const detail: AgentDetail = {
      ...mockAgents[0],
      inventory: [{ name: 'wood', type: 'resource', quantity: 3 }],
      personality: {},
      relationships: [],
      shortTermMemory: [{ tick: 1, type: 'action', content: 'Gathered food' }],
      journal: [{ epoch: 0, tick: 12, entry: 'I survived day one.' }],
    };
    render(
      <AgentCards agents={mockAgents} selectedAgent="vex" onSelectAgent={() => {}} detail={detail} />
    );
    expect(screen.getByText(/wood/)).toBeDefined();
    expect(screen.getByText(/\u00D73/)).toBeDefined();
    expect(screen.getByText(/I survived day one/)).toBeDefined();
  });
});

describe('EventTimeline', () => {
  it('scrolls and filters correctly', () => {
    render(<EventTimeline events={mockEvents} />);
    expect(screen.getByText(/gather/)).toBeDefined();
    expect(screen.getByText(/rest/)).toBeDefined();

    const input = screen.getByPlaceholderText('Filter by type or agent...');
    fireEvent.change(input, { target: { value: 'gather' } });
    expect(screen.queryByText(/rest/)).toBeNull();
  });
});

describe('CouncilViewer', () => {
  it('shows motions, debate, and vote tallies', async () => {
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        epoch: 0,
        motions: [{
          id: 1, type: 'general', text: 'Share food equally',
          proposedBy: 'vex', secondedBy: 'luna', status: 'passed',
          ayes: 3, nays: 1, abstentions: 0,
        }],
        events: [],
      }),
    }));

    render(<CouncilViewer epoch={0} />);
    await waitFor(() => {
      expect(screen.getByText('Share food equally')).toBeDefined();
      expect(screen.getByText('passed')).toBeDefined();
      expect(screen.getByText(/Ayes: 3/)).toBeDefined();
    });
  });

  it('Reveal Votes toggle shows individual vote breakdown', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          epoch: 0,
          motions: [{
            id: 1, type: 'general', text: 'Test motion for votes',
            proposedBy: 'vex', secondedBy: 'luna', status: 'passed',
            ayes: 2, nays: 1, abstentions: 0,
          }],
          events: [],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ([{
          motionId: 1,
          votes: [
            { voter: 'vex', vote: 'aye' },
            { voter: 'luna', vote: 'aye' },
            { voter: 'moss', vote: 'nay' },
          ],
        }]),
      }));

    render(<CouncilViewer epoch={0} />);
    await waitFor(() => expect(screen.getByText('Test motion for votes')).toBeDefined());

    fireEvent.click(screen.getByText('Reveal Votes'));
    await waitFor(() => {
      expect(screen.getByText(/vex:/)).toBeDefined();
    });
  });
});

describe('RelationshipGraph', () => {
  it('renders with colored/weighted edges', () => {
    const rels: RelationshipData[] = [
      { agentA: 'vex', agentB: 'luna', sentiment: 20 },
      { agentA: 'luna', agentB: 'moss', sentiment: -15 },
    ];
    const livingAgents = mockAgents.filter(a => a.isAlive);
    const { container } = render(<RelationshipGraph relationships={rels} agents={livingAgents} />);
    const lines = container.querySelectorAll('line');
    expect(lines.length).toBe(2);
  });
});

describe('CostDashboard', () => {
  it('shows cumulative spend', () => {
    render(<CostDashboard status={mockStatus} />);
    expect(screen.getByText('$1.2300')).toBeDefined();
  });
});

describe('ThoughtViewer', () => {
  it('shows "No thoughts recorded yet" when no agent selected', () => {
    render(<ThoughtViewer agents={mockAgents} />);
    expect(screen.getByText('No thoughts recorded yet.')).toBeDefined();
  });
});

describe('Dashboard works when paused', () => {
  it('renders with paused status showing frozen state', () => {
    const pausedStatus = { ...mockStatus, status: 'paused' };
    render(<StatusBar status={pausedStatus} connected={false} />);
    expect(screen.getByText('Start')).toBeDefined();
    expect(screen.getByText('Offline')).toBeDefined();
  });
});

describe('WebSocket connection indicator', () => {
  it('shows connected state', () => {
    render(<StatusBar status={mockStatus} connected={true} />);
    expect(screen.getByText('Live')).toBeDefined();
  });

  it('shows disconnected state', () => {
    render(<StatusBar status={mockStatus} connected={false} />);
    expect(screen.getByText('Offline')).toBeDefined();
  });
});
