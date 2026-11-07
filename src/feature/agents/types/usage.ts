export interface Usage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}

export function addUsage(total: Usage | null, usage: Usage | null): Usage | null {
  if (usage === null) return total;
  if (total === null) return { ...usage };
  return {
    inputTokens: total.inputTokens + usage.inputTokens,
    outputTokens: total.outputTokens + usage.outputTokens,
    costUsd:
      total.costUsd === null && usage.costUsd === null
        ? null
        : (total.costUsd ?? 0) + (usage.costUsd ?? 0),
  };
}
