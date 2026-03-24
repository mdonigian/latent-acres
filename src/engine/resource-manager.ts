import type Database from 'better-sqlite3';
import { getAllResources, updateResourceQuantity } from '../db/queries.js';

export function regenerateResources(db: Database.Database): void {
  const resources = getAllResources(db);
  for (const res of resources) {
    if (res.quantity < res.max_quantity) {
      const newQuantity = Math.min(res.quantity + res.regen_rate, res.max_quantity);
      updateResourceQuantity(db, res.id, newQuantity);
    }
  }
}

export function depleteResource(db: Database.Database, resourceId: string, currentQuantity: number, amount: number): number {
  const actualAmount = Math.min(amount, currentQuantity);
  const newQuantity = Math.max(0, currentQuantity - actualAmount);
  updateResourceQuantity(db, resourceId, newQuantity);
  return actualAmount;
}
