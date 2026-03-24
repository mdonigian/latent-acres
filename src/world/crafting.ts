import type Database from 'better-sqlite3';
import { getAgentInventory, addInventoryItem, updateInventoryQuantity } from '../db/queries.js';

export interface CraftingRecipe {
  id: string;
  name: string;
  inputs: { itemName: string; quantity: number }[];
  output: { itemName: string; itemType: string; quantity: number; properties?: Record<string, unknown> };
}

export const RECIPES: CraftingRecipe[] = [
  {
    id: 'fishing_spear',
    name: 'Fishing Spear',
    inputs: [
      { itemName: 'wood', quantity: 2 },
      { itemName: 'stone', quantity: 1 },
    ],
    output: { itemName: 'fishing_spear', itemType: 'tool', quantity: 1, properties: { gatherBonus: 0.3 } },
  },
  {
    id: 'shelter',
    name: 'Shelter',
    inputs: [
      { itemName: 'wood', quantity: 5 },
      { itemName: 'fiber', quantity: 3 },
    ],
    output: { itemName: 'shelter', itemType: 'structure', quantity: 1, properties: { restBonus: 10 } },
  },
  {
    id: 'rope',
    name: 'Rope',
    inputs: [
      { itemName: 'fiber', quantity: 4 },
    ],
    output: { itemName: 'rope', itemType: 'material', quantity: 1 },
  },
  {
    id: 'stone_axe',
    name: 'Stone Axe',
    inputs: [
      { itemName: 'wood', quantity: 1 },
      { itemName: 'stone', quantity: 2 },
    ],
    output: { itemName: 'stone_axe', itemType: 'tool', quantity: 1, properties: { gatherBonus: 0.2 } },
  },
];

export interface CraftResult {
  success: boolean;
  reason?: string;
  outputItem?: string;
}

export function getRecipe(recipeId: string): CraftingRecipe | undefined {
  return RECIPES.find(r => r.id === recipeId);
}

export function canCraft(db: Database.Database, agentId: string, recipeId: string): CraftResult {
  const recipe = getRecipe(recipeId);
  if (!recipe) {
    return { success: false, reason: `Unknown recipe: ${recipeId}` };
  }

  const inventory = getAgentInventory(db, agentId);
  for (const input of recipe.inputs) {
    const item = inventory.find(i => i.item_name === input.itemName);
    const available = item ? item.quantity : 0;
    if (available < input.quantity) {
      return { success: false, reason: `Insufficient ${input.itemName}: need ${input.quantity}, have ${available}` };
    }
  }

  return { success: true };
}

export function craft(db: Database.Database, agentId: string, recipeId: string): CraftResult {
  const check = canCraft(db, agentId, recipeId);
  if (!check.success) return check;

  const recipe = getRecipe(recipeId)!;
  const inventory = getAgentInventory(db, agentId);

  // Consume inputs
  for (const input of recipe.inputs) {
    const item = inventory.find(i => i.item_name === input.itemName)!;
    updateInventoryQuantity(db, item.id, item.quantity - input.quantity);
  }

  // Produce output
  const outputId = `${agentId}_${recipe.output.itemName}_${Date.now()}`;
  addInventoryItem(db, {
    id: outputId,
    agentId,
    itemName: recipe.output.itemName,
    itemType: recipe.output.itemType,
    quantity: recipe.output.quantity,
    propertiesJson: recipe.output.properties ? JSON.stringify(recipe.output.properties) : undefined,
  });

  return { success: true, outputItem: recipe.output.itemName };
}
