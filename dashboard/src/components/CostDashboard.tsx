import React from 'react';
import type { StatusData } from '../types.js';

export function CostDashboard({ status }: { status: StatusData | null }) {
  if (!status) return null;

  const avgCostPerTick = status.tick > 0 ? status.cost / status.tick : 0;
  const projected = avgCostPerTick * 100;

  return (
    <div className="p-4 space-y-2 text-sm">
      <h3 className="font-bold">Cost Dashboard</h3>
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-gray-800 p-2 rounded">
          <div className="text-xs text-gray-400">Total Cost</div>
          <div className="text-lg font-bold">${status.cost.toFixed(4)}</div>
        </div>
        <div className="bg-gray-800 p-2 rounded">
          <div className="text-xs text-gray-400">Avg/Tick</div>
          <div className="text-lg font-bold">${avgCostPerTick.toFixed(4)}</div>
        </div>
        <div className="bg-gray-800 p-2 rounded">
          <div className="text-xs text-gray-400">Ticks Run</div>
          <div className="text-lg font-bold">{status.tick}</div>
        </div>
        <div className="bg-gray-800 p-2 rounded">
          <div className="text-xs text-gray-400">Projected (100 ticks)</div>
          <div className="text-lg font-bold">${projected.toFixed(2)}</div>
        </div>
      </div>
    </div>
  );
}
