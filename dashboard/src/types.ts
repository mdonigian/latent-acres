export interface StatusData {
  tick: number;
  epoch: number;
  phase: string;
  status: string;
  livingAgents: number;
  totalAgents: number;
  cost: number;
}

export interface AgentData {
  id: string;
  name: string;
  health: number;
  hunger: number;
  energy: number;
  location: string;
  isAlive: boolean;
  isChieftain: boolean;
  isBanished: boolean;
}

export interface JournalEntry {
  epoch: number;
  tick: number;
  entry: string;
}

export interface AgentDetail extends AgentData {
  inventory: { name: string; type: string; quantity: number }[];
  personality: Record<string, unknown>;
  relationships: { other: string; sentiment: number }[];
  shortTermMemory: { tick: number; type: string; content: string }[];
  journal?: JournalEntry[];
}

export interface LocationData {
  id: string;
  name: string;
  description: string;
  resources: { type: string; quantity: number; maxQuantity: number; availability: string }[];
  agents: { id: string; name: string }[];
  connectedTo: string[];
  structures?: { type: string; properties: Record<string, unknown> }[];
}

export interface MapData {
  nodes: { id: string; name: string; dangerLevel: number }[];
  edges: { from: string; to: string }[];
}

export interface EventData {
  id: number;
  tick: number;
  epoch: number;
  eventType: string;
  agentId: string | null;
  data: Record<string, unknown>;
}

export interface CouncilData {
  epoch: number;
  motions: {
    id: number;
    type: string;
    text: string;
    proposedBy: string;
    secondedBy: string | null;
    status: string;
    ayes: number;
    nays: number;
    abstentions: number;
  }[];
  events?: { tick: number; type: string; data: Record<string, unknown> }[];
}

export interface RelationshipData {
  agentA: string;
  agentB: string;
  sentiment: number;
}
