import type { UsageRecord } from "./thread";

export interface OwnerCost {
  cost: { amount: number; currency: string; unpriced_requests: number };
  request_count: number;
}

export function costLabel(record: OwnerCost) {
  if (record.request_count > 0 && record.cost.unpriced_requests === record.request_count) {
    return `${record.request_count} 次请求尚未计费`;
  }
  const amount = record.cost.amount.toLocaleString("en-US", {
    minimumFractionDigits: 6,
    maximumFractionDigits: 9,
  });
  const priced = `预估 ${record.cost.currency} ${amount}`;
  return record.cost.unpriced_requests
    ? `${priced} · ${record.cost.unpriced_requests} 次请求尚未计费`
    : priced;
}

const labels: Record<string, string> = {
  input_tokens: "输入",
  output_tokens: "输出",
  prompt_tokens: "输入",
  completion_tokens: "输出",
  total_tokens: "合计",
  cache_read_input_tokens: "缓存读取",
  cache_creation_input_tokens: "缓存写入",
};

export function usageSummary(records: UsageRecord[]) {
  const tokens = new Map<string, number>();
  const costs = new Map<string, number>();
  let missing = 0;
  for (const record of records) {
    for (const [key, value] of Object.entries(record.usage)) {
      if (
        key.endsWith("_tokens") &&
        typeof value === "number" &&
        Number.isSafeInteger(value) &&
        value >= 0
      ) {
        tokens.set(key, (tokens.get(key) || 0) + value);
      }
    }
    const cost = record.metering?.cost;
    if (cost) {
      costs.set(cost.currency, (costs.get(cost.currency) || 0) + cost.amount);
    } else {
      missing++;
    }
  }
  return {
    tokens: [...tokens]
      .filter(
        ([key, value]) =>
          value > 0 ||
          [
            "input_tokens",
            "output_tokens",
            "prompt_tokens",
            "completion_tokens",
            "total_tokens",
          ].includes(key),
      )
      .map(([key, value]) => `${labels[key] || key} ${value.toLocaleString("en-US")}`),
    costs: [...costs].map(([currency, amount]) => {
      const formatted = amount.toLocaleString("en-US", {
        minimumFractionDigits: 4,
        maximumFractionDigits: 8,
      });
      return `预估 ${currency} ${formatted}`;
    }),
    missing,
    raw: records.length === 1 ? records[0].usage : records.map((record) => record.usage),
  };
}
