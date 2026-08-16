export const clampSelectedBudget = (budget: number, selectedCount: number) => Math.min(Math.max(1, budget), Math.max(1, selectedCount));
