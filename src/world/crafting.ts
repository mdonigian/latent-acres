import type Database from 'better-sqlite3';
import { getAgentInventory, addInventoryItem, updateInventoryQuantity, createLocationStructure, getStructuresAtLocation, removeLocationStructure } from '../db/queries.js';

export interface CraftingRecipe {
  id: string;
  name: string;
  tier: number;
  inputs: { itemName: string; quantity: number }[];
  output: { itemName: string; itemType: string; quantity: number; properties?: Record<string, unknown> };
  isStructure?: boolean;
}

export const RECIPES: CraftingRecipe[] = [
  // Tier 1 — Basic (raw resources only)
  {
    id: 'stone_axe', name: 'Stone Axe', tier: 1,
    inputs: [{ itemName: 'wood', quantity: 1 }, { itemName: 'stone', quantity: 2 }],
    output: { itemName: 'stone_axe', itemType: 'tool', quantity: 1, properties: { gatherBonus: 0.2 } },
  },
  {
    id: 'fishing_spear', name: 'Fishing Spear', tier: 1,
    inputs: [{ itemName: 'wood', quantity: 2 }, { itemName: 'stone', quantity: 1 }],
    output: { itemName: 'fishing_spear', itemType: 'tool', quantity: 1, properties: { gatherBonus: 0.3 } },
  },
  {
    id: 'rope', name: 'Rope', tier: 1,
    inputs: [{ itemName: 'fiber', quantity: 4 }],
    output: { itemName: 'rope', itemType: 'material', quantity: 1 },
  },
  {
    id: 'clay_brick', name: 'Clay Brick', tier: 1,
    inputs: [{ itemName: 'clay', quantity: 3 }, { itemName: 'wood', quantity: 1 }],
    output: { itemName: 'clay_brick', itemType: 'material', quantity: 1 },
  },
  {
    id: 'torch', name: 'Torch', tier: 1,
    inputs: [{ itemName: 'wood', quantity: 1 }, { itemName: 'fiber', quantity: 1 }],
    output: { itemName: 'torch', itemType: 'tool', quantity: 1 },
  },
  {
    id: 'herbal_poultice', name: 'Herbal Poultice', tier: 1,
    inputs: [{ itemName: 'herbs', quantity: 2 }, { itemName: 'freshwater', quantity: 1 }],
    output: { itemName: 'herbal_poultice', itemType: 'consumable', quantity: 1, properties: { healAmount: 20 } },
  },

  // Tier 2 — Intermediate (require Tier 1 crafted items as inputs)
  {
    id: 'treated_wood', name: 'Treated Wood', tier: 2,
    inputs: [{ itemName: 'wood', quantity: 2 }, { itemName: 'freshwater', quantity: 1 }],
    output: { itemName: 'treated_wood', itemType: 'material', quantity: 1 },
  },
  {
    id: 'woven_mat', name: 'Woven Mat', tier: 2,
    inputs: [{ itemName: 'fiber', quantity: 2 }, { itemName: 'rope', quantity: 1 }],
    output: { itemName: 'woven_mat', itemType: 'material', quantity: 1 },
  },
  {
    id: 'clay_pot', name: 'Clay Pot', tier: 2,
    inputs: [{ itemName: 'clay', quantity: 2 }, { itemName: 'wood', quantity: 1 }],
    output: { itemName: 'clay_pot', itemType: 'material', quantity: 1 },
  },
  {
    id: 'herbal_tea', name: 'Herbal Tea', tier: 2,
    inputs: [{ itemName: 'herbs', quantity: 1 }, { itemName: 'freshwater', quantity: 1 }, { itemName: 'clay_pot', quantity: 1 }],
    output: { itemName: 'herbal_tea', itemType: 'consumable', quantity: 1, properties: { energyRestore: 15, hungerReduce: 10 } },
  },
  {
    id: 'medicine', name: 'Medicine', tier: 2,
    inputs: [{ itemName: 'herbs', quantity: 3 }, { itemName: 'freshwater', quantity: 2 }, { itemName: 'clay_pot', quantity: 1 }],
    output: { itemName: 'medicine', itemType: 'consumable', quantity: 1, properties: { healAmount: 40 } },
  },

  // Tier 3 — Advanced Tools (require intermediate materials)
  {
    id: 'reinforced_axe', name: 'Reinforced Axe', tier: 3,
    inputs: [{ itemName: 'stone_axe', quantity: 1 }, { itemName: 'rope', quantity: 1 }, { itemName: 'treated_wood', quantity: 1 }],
    output: { itemName: 'reinforced_axe', itemType: 'tool', quantity: 1, properties: { gatherBonus: 0.5 } },
  },
  {
    id: 'fishing_net', name: 'Fishing Net', tier: 3,
    inputs: [{ itemName: 'rope', quantity: 3 }, { itemName: 'fiber', quantity: 2 }],
    output: { itemName: 'fishing_net', itemType: 'tool', quantity: 1, properties: { gatherBonus: 0.6 } },
  },
  {
    id: 'water_skin', name: 'Water Skin', tier: 3,
    inputs: [{ itemName: 'fiber', quantity: 2 }, { itemName: 'rope', quantity: 1 }],
    output: { itemName: 'water_skin', itemType: 'tool', quantity: 1 },
  },

  // Tier 4 — Structures (placed at location, not in agent inventory)
  {
    id: 'shelter', name: 'Shelter', tier: 4, isStructure: true,
    inputs: [{ itemName: 'wood', quantity: 5 }, { itemName: 'fiber', quantity: 3 }],
    output: { itemName: 'shelter', itemType: 'structure', quantity: 1, properties: { restBonus: 10 } },
  },
  {
    id: 'hut', name: 'Hut', tier: 4, isStructure: true,
    inputs: [{ itemName: 'treated_wood', quantity: 3 }, { itemName: 'rope', quantity: 2 }, { itemName: 'clay_brick', quantity: 4 }],
    output: { itemName: 'hut', itemType: 'structure', quantity: 1, properties: { restBonus: 25, weatherProtection: true } },
  },
  {
    id: 'storage_chest', name: 'Storage Chest', tier: 4, isStructure: true,
    inputs: [{ itemName: 'wood', quantity: 3 }, { itemName: 'rope', quantity: 2 }],
    output: { itemName: 'storage_chest', itemType: 'structure', quantity: 1, properties: { sharedStorage: true, capacity: 20 } },
  },
  {
    id: 'signal_fire', name: 'Signal Fire', tier: 4, isStructure: true,
    inputs: [{ itemName: 'wood', quantity: 4 }, { itemName: 'stone', quantity: 2 }, { itemName: 'rope', quantity: 1 }],
    output: { itemName: 'signal_fire', itemType: 'structure', quantity: 1, properties: { signalRange: 2 } },
  },
  {
    id: 'defensive_wall', name: 'Defensive Wall', tier: 4, isStructure: true,
    inputs: [{ itemName: 'stone', quantity: 6 }, { itemName: 'clay_brick', quantity: 4 }, { itemName: 'rope', quantity: 2 }],
    output: { itemName: 'defensive_wall', itemType: 'structure', quantity: 1, properties: { dangerReduction: 0.3 } },
  },
  {
    id: 'rain_collector', name: 'Rain Collector', tier: 4, isStructure: true,
    inputs: [{ itemName: 'treated_wood', quantity: 2 }, { itemName: 'clay_pot', quantity: 1 }, { itemName: 'fiber', quantity: 2 }],
    output: { itemName: 'rain_collector', itemType: 'structure', quantity: 1, properties: { freshwaterGen: 2 } },
  },
  {
    id: 'drying_rack', name: 'Drying Rack', tier: 4, isStructure: true,
    inputs: [{ itemName: 'wood', quantity: 3 }, { itemName: 'rope', quantity: 2 }, { itemName: 'woven_mat', quantity: 1 }],
    output: { itemName: 'drying_rack', itemType: 'structure', quantity: 1, properties: { foodBonus: 1 } },
  },
  {
    id: 'kiln', name: 'Kiln', tier: 4, isStructure: true,
    inputs: [{ itemName: 'stone', quantity: 5 }, { itemName: 'clay', quantity: 3 }, { itemName: 'wood', quantity: 2 }],
    output: { itemName: 'kiln', itemType: 'structure', quantity: 1, properties: { doublesClayBrick: true } },
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

export function craft(
  db: Database.Database,
  agentId: string,
  recipeId: string,
  locationId?: string,
  tick?: number,
): CraftResult {
  const check = canCraft(db, agentId, recipeId);
  if (!check.success) return check;

  const recipe = getRecipe(recipeId)!;

  if (recipe.isStructure && !locationId) {
    return { success: false, reason: `Cannot craft structure ${recipeId}: location required` };
  }

  return (db.transaction(() => {
    const inventory = getAgentInventory(db, agentId);

    // Re-verify inside transaction for atomicity
    for (const input of recipe.inputs) {
      const item = inventory.find(i => i.item_name === input.itemName);
      const available = item ? item.quantity : 0;
      if (available < input.quantity) {
        return { success: false, reason: `Insufficient ${input.itemName}: need ${input.quantity}, have ${available}` };
      }
    }

    // Consume inputs
    for (const input of recipe.inputs) {
      const item = inventory.find(i => i.item_name === input.itemName)!;
      updateInventoryQuantity(db, item.id, item.quantity - input.quantity);
    }

    // Determine output quantity (kiln doubles clay_brick output)
    let outputQty = recipe.output.quantity;
    if (recipeId === 'clay_brick' && locationId) {
      const structures = getStructuresAtLocation(db, locationId);
      if (structures.some(s => s.structure_type === 'kiln')) {
        outputQty = 2;
      }
    }

    if (recipe.isStructure && locationId) {
      // Only one shelter or hut per location — replace the old one
      if (recipe.id === 'shelter' || recipe.id === 'hut') {
        const existing = getStructuresAtLocation(db, locationId);
        for (const s of existing) {
          if (s.structure_type === 'shelter' || s.structure_type === 'hut') {
            removeLocationStructure(db, s.id);
          }
        }
      }

      createLocationStructure(db, {
        id: `${locationId}_${recipe.id}_${tick ?? Date.now()}`,
        locationId,
        structureType: recipe.id,
        builtByAgentId: agentId,
        builtAtTick: tick,
        propertiesJson: recipe.output.properties ? JSON.stringify(recipe.output.properties) : undefined,
      });
    } else {
      const outputId = `${agentId}_${recipe.output.itemName}_${tick ?? Date.now()}`;
      addInventoryItem(db, {
        id: outputId,
        agentId,
        itemName: recipe.output.itemName,
        itemType: recipe.output.itemType,
        quantity: outputQty,
        propertiesJson: recipe.output.properties ? JSON.stringify(recipe.output.properties) : undefined,
      });
    }

    return { success: true, outputItem: recipe.output.itemName };
  }))();
}
