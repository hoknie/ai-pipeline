export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export function addUsage(total: Usage | null, usage: Usage | null): Usage | null {
  if (usage === null) return total;
  if (total === null) return { ...usage };
  return {
    inputTokens: total.inputTokens + usage.inputTokens,
    outputTokens: total.outputTokens + usage.outputTokens,
  };
}
