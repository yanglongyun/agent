import rules from "./rules.js";

const count = (value) => Number.isSafeInteger(value) && value >= 0;

// 数据库累计金额以十亿分之一美元保存，对外统一返回美元金额。
export function withCost(row) {
  const { total_cost_nanos, unpriced_requests, ...record } = row;
  return {
    ...record,
    cost: { amount: total_cost_nanos / 1e9, currency: "USD", unpriced_requests },
  };
}

// 压缩只使用厂商已报告的用量；不修改 usage，也不估算历史长度。
export function contextTokens(usage, protocol) {
  if (!usage) {
    return null;
  }
  if (count(usage.total_tokens)) {
    return usage.total_tokens;
  }
  if (
    protocol !== "anthropic-messages" ||
    !count(usage.input_tokens) ||
    !count(usage.output_tokens)
  ) {
    return null;
  }
  const writes = usage.cache_creation_input_tokens ?? 0;
  const reads = usage.cache_read_input_tokens ?? 0;
  if (!count(writes) || !count(reads)) {
    return null;
  }
  return usage.input_tokens + usage.output_tokens + writes + reads;
}

export default function measure(usage, { protocol, model, url, serviceTier }) {
  if (!usage) {
    return null;
  }
  const measurement = {
    protocol,
    model,
    endpoint: new URL(url).origin,
    context_tokens: contextTokens(usage, protocol),
    cost: null,
    status: "unpriced",
  };
  const rule = rules.find((entry) => entry.protocols.includes(protocol) && entry.model === model);
  if (!rule) {
    return measurement;
  }

  const chat = protocol === "chat-completions";
  let ordinary = chat ? usage.prompt_tokens : usage.input_tokens;
  let reads = 0;
  let writes = 0;
  let longWrites = 0;
  let input = ordinary;
  const output = chat ? usage.completion_tokens : usage.output_tokens;
  let multiplier = 1;
  if (protocol === "responses" || chat) {
    const details = chat ? usage.prompt_tokens_details : usage.input_tokens_details;
    reads = details?.cached_tokens ?? 0;
    const allWrites = details?.cache_write_tokens ?? 0;
    longWrites = details?.cache_write_tokens_details?.ttl_12h_tokens ?? 0;
    if (![input, output, reads, allWrites, longWrites].every(count)) {
      return { ...measurement, status: "invalid_usage" };
    }
    writes = allWrites - longWrites;
    if (
      details?.cache_write_tokens_details &&
      details.cache_write_tokens_details.ttl_30m_tokens !== writes
    ) {
      return { ...measurement, status: "invalid_usage" };
    }
    ordinary = input - reads - allWrites;
    const multipliers = { default: 1, standard: 1, flex: 0.5, priority: 2, fast: 2, ultrafast: 6 };
    multiplier = multipliers[serviceTier || "default"];
    if (
      typeof multiplier !== "number" ||
      (serviceTier === "ultrafast" && model !== "gpt-6.1-sol")
    ) {
      return { ...measurement, status: "unsupported_tier" };
    }
  } else {
    reads = usage.cache_read_input_tokens ?? 0;
    const allWrites = usage.cache_creation_input_tokens ?? 0;
    longWrites = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
    if (![input, output, reads, allWrites, longWrites].every(count)) {
      return { ...measurement, status: "invalid_usage" };
    }
    writes = allWrites - longWrites;
    if (usage.cache_creation && usage.cache_creation.ephemeral_5m_input_tokens !== writes) {
      return { ...measurement, status: "invalid_usage" };
    }
    input += reads + allWrites;
    if (usage.speed && usage.speed !== "standard") {
      return { ...measurement, status: "unsupported_tier" };
    }
    if (
      (usage.service_tier && usage.service_tier !== "standard") ||
      (usage.inference_geo && usage.inference_geo !== "global")
    ) {
      return { ...measurement, status: "unsupported_tier" };
    }
  }
  if (![ordinary, reads, writes, longWrites, output, input].every(count)) {
    return { ...measurement, status: "invalid_usage" };
  }
  const rates = rule.rates.find((entry) => entry.through === null || input <= entry.through);
  const units = [
    { kind: "input", tokens: ordinary, rate: rates.input },
    { kind: "output", tokens: output, rate: rates.output },
    { kind: "cached", tokens: reads, rate: rates.cached },
    { kind: "cache_write", tokens: writes, rate: rates.write },
    { kind: "cache_write_long", tokens: longWrites, rate: rates.write_long },
  ];
  // 以十亿分之一美元计价后求和，保留小额请求费用，避免逐项浮点累加。
  let nanos = 0;
  for (const unit of units) {
    unit.rate *= multiplier;
    const amount = Math.round(unit.tokens * unit.rate * 1000);
    nanos += amount;
    unit.amount = amount / 1e9;
  }
  return {
    ...measurement,
    status: "priced",
    cost: {
      amount: nanos / 1e9,
      currency: rule.currency,
      basis: "list_price_estimate",
      reference: rule.reference,
      rule_date: "2026-11-10",
      tier: serviceTier || "standard",
      units,
    },
  };
}
