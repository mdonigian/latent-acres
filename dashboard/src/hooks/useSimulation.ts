import { useState, useEffect, useCallback, useRef } from 'react';
import type { StatusData, AgentData, AgentDetail, LocationData, MapData, EventData, CouncilData, RelationshipData } from '../types.js';

const API_BASE = '/api';

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export function useSimulation() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [agents, setAgents] = useState<AgentData[]>([]);
  const [locations, setLocations] = useState<LocationData[]>([]);
  const [mapData, setMapData] = useState<MapData | null>(null);
  const [events, setEvents] = useState<EventData[]>([]);
  const [relationships, setRelationships] = useState<RelationshipData[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, a, l, m, e, r] = await Promise.all([
        fetchJson<StatusData>('/status'),
        fetchJson<AgentData[]>('/agents'),
        fetchJson<LocationData[]>('/locations'),
        fetchJson<MapData>('/map'),
        fetchJson<EventData[]>('/events?limit=50'),
        fetchJson<RelationshipData[]>('/relationships'),
      ]);
      setStatus(s);
      setAgents(a);
      setLocations(l);
      setMapData(m);
      setEvents(e);
      setRelationships(r);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    refresh();

    function connectWs() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        setTimeout(connectWs, 3000);
      };
      ws.onerror = () => ws.close();
      ws.onmessage = () => refresh();
    }

    connectWs();

    // Fallback polling
    const interval = setInterval(() => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        refresh();
      }
    }, 5000);

    return () => {
      clearInterval(interval);
      wsRef.current?.close();
    };
  }, [refresh]);

  return { status, agents, locations, mapData, events, relationships, connected, error, refresh };
}

export function useAgentDetail(agentId: string | null) {
  const [detail, setDetail] = useState<AgentDetail | null>(null);

  useEffect(() => {
    if (!agentId) { setDetail(null); return; }
    fetchJson<AgentDetail>(`/agents/${agentId}`).then(setDetail).catch(() => setDetail(null));
  }, [agentId]);

  return detail;
}

export function useCouncil(epoch: number | null) {
  const [council, setCouncil] = useState<CouncilData | null>(null);

  useEffect(() => {
    if (epoch === null) { setCouncil(null); return; }
    fetchJson<CouncilData>(`/council/${epoch}`).then(setCouncil).catch(() => setCouncil(null));
  }, [epoch]);

  return council;
}
