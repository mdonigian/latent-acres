import type Database from 'better-sqlite3';
import { getAllResources, updateResourceQuantity, getAllLocations, getStructuresAtLocation, getResourcesAtLocation } from '../db/queries.js';

export function regenerateResources(db: Database.Database): void {
  const resources = getAllResources(db);
  for (const res of resources) {
    if (res.quantity < res.max_quantity) {
      const newQuantity = Math.min(Math.floor(res.quantity + res.regen_rate), res.max_quantity);
      updateResourceQuantity(db, res.id, newQuantity);
    }
  }

  // Rain collector freshwater generation
  const locations = getAllLocations(db);
  for (const loc of locations) {
    const structures = getStructuresAtLocation(db, loc.id);
    const rainCollector = structures.find(s => s.structure_type === 'rain_collector');
    if (!rainCollector) continue;
    const props = rainCollector.properties_json ? JSON.parse(rainCollector.properties_json) : {};
    const freshwaterGen = props.freshwaterGen ?? 0;
    if (freshwaterGen <= 0) continue;
    const locResources = getResourcesAtLocation(db, loc.id);
    const freshwater = locResources.find(r => r.type === 'freshwater');
    if (freshwater) {
      const newQty = Math.min(freshwater.quantity + freshwaterGen, freshwater.max_quantity);
      updateResourceQuantity(db, freshwater.id, newQty);
    }
  }
}

export function depleteResource(db: Database.Database, resourceId: string, currentQuantity: number, amount: number): number {
  const actualAmount = Math.min(amount, currentQuantity);
  const newQuantity = Math.max(0, currentQuantity - actualAmount);
  updateResourceQuantity(db, resourceId, newQuantity);
  return actualAmount;
}
