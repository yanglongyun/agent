import test from "node:test";
import assert from "node:assert/strict";
import measure, { contextTokens } from "../metering/index.js";

const target = {
  protocol: "responses",
  model: "gpt-6.1-sol",
  url: "https://llm.wisehood.ai/openai/v1/responses",
};

test("六个模型的公开标价规则分别计费，usage 不被改写", () => {
  for (const [model, protocol, amount] of [
    ["gpt-6-luna", "responses", 0.00015],
    ["gpt-6.1-terra", "responses", 0.0015],
    ["gpt-6.1-sol", "responses", 0.003],
    ["claude-fable-5-2", "anthropic-messages", 0.012],
    ["claude-sonnet-5-5", "anthropic-messages", 0.003],
    ["claude-opus-5-5", "anthropic-messages", 0.006],
  ]) {
    const usage = { input_tokens: 1000, output_tokens: 100 };
    const before = structuredClone(usage);
    const result = measure(usage, { ...target, model, protocol });
    assert.equal(result.cost.amount, amount);
    assert.equal(result.cost.basis, "list_price_estimate");
    assert.deepEqual(usage, before);
  }
});

test("GPT 缓存命中与两种写入时长分别计费，推理 token 不重复收费", () => {
  const usage = {
    input_tokens: 12000,
    input_tokens_details: {
      cached_tokens: 4000,
      cache_write_tokens: 7000,
      cache_write_tokens_details: { ttl_30m_tokens: 3000, ttl_12h_tokens: 4000 },
    },
    output_tokens: 300,
    output_tokens_details: { reasoning_tokens: 200 },
    total_tokens: 12300,
  };
  const result = measure(usage, target);
  assert.equal(result.cost.amount, 0.0329);
  assert.equal(result.context_tokens, 12300);
  assert.deepEqual(
    result.cost.units.map((unit) => unit.tokens),
    [1000, 300, 4000, 3000, 4000],
  );
  assert.equal(measure(usage, { ...target, serviceTier: "flex" }).cost.amount, 0.01645);
  assert.equal(measure(usage, { ...target, serviceTier: "priority" }).cost.amount, 0.0658);
});

test("Chat 保留 prompt/completion 原始字段，缓存与输出按相同模型规则计价", () => {
  const usage = {
    prompt_tokens: 12000,
    prompt_tokens_details: {
      cached_tokens: 4000,
      cache_write_tokens: 7000,
      cache_write_tokens_details: { ttl_30m_tokens: 3000, ttl_12h_tokens: 4000 },
    },
    completion_tokens: 300,
    completion_tokens_details: { reasoning_tokens: 200 },
    total_tokens: 12300,
  };
  const before = structuredClone(usage);
  const result = measure(usage, { ...target, protocol: "chat-completions" });
  assert.equal(result.cost.amount, 0.0329);
  assert.equal(result.context_tokens, 12300);
  assert.deepEqual(usage, before);
  assert.equal(
    measure(
      { prompt_tokens: 272001, completion_tokens: 100 },
      { ...target, protocol: "chat-completions" },
    ).cost.amount,
    1.089504,
  );
});

test("GPT 长上下文在 272000 输入 token 后切换整次请求价格", () => {
  assert.equal(measure({ input_tokens: 272000, output_tokens: 100 }, target).cost.amount, 0.545);
  const long = measure({ input_tokens: 272001, output_tokens: 100 }, target);
  assert.equal(long.cost.amount, 1.089504);
  assert.equal(long.cost.units[1].rate, 15);
});

test("Claude 原生输入不包含缓存，两种写入分开收费且不重复累加", () => {
  const usage = {
    input_tokens: 100,
    output_tokens: 200,
    cache_read_input_tokens: 1000,
    cache_creation_input_tokens: 500,
    cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 300 },
  };
  const result = measure(usage, {
    ...target,
    model: "claude-fable-5-2",
    protocol: "anthropic-messages",
  });
  assert.equal(result.context_tokens, 1800);
  assert.equal(result.cost.amount, 0.0158);
  assert.equal(usage.total_tokens, undefined);
  assert.equal(usage.input_tokens, 100);
});

test("缺少价格或用量不会产生零费用；有效零用量可以计为零", () => {
  assert.equal(measure(null, target), null);
  assert.equal(
    measure({ input_tokens: 1, output_tokens: 1 }, { ...target, model: "unknown" }).cost,
    null,
  );
  assert.equal(measure({ input_tokens: 1 }, target).status, "invalid_usage");
  assert.equal(
    measure({ input_tokens: 1, output_tokens: 1 }, { ...target, serviceTier: "unknown" }).cost,
    null,
  );
  assert.equal(measure({ input_tokens: 0, output_tokens: 0 }, target).cost.amount, 0);
  assert.equal(contextTokens({ total_tokens: -1 }, "responses"), null);
  assert.equal(contextTokens({ input_tokens: 100 }, "anthropic-messages"), null);
});

test("不合法的缓存计数和分项不一致不能默默折算费用", () => {
  for (const details of [
    { cached_tokens: 11 },
    { cache_write_tokens: -1 },
    { cache_write_tokens: 3, cache_write_tokens_details: { ttl_30m_tokens: 1, ttl_12h_tokens: 1 } },
    { cached_tokens: 0.5 },
  ]) {
    assert.equal(
      measure({ input_tokens: 10, output_tokens: 1, input_tokens_details: details }, target).status,
      "invalid_usage",
    );
  }
});

test("DeepSeek 按 UTC 工作日高峰与平峰分别计价", () => {
  const usage = {
    input_tokens: 1000000,
    input_tokens_details: { cached_tokens: 600000 },
    output_tokens: 100000,
  };
  const deepseek = {
    ...target,
    model: "deepseek-flash",
    url: "https://api.deepseek.com/v1/responses",
  };
  const peak = measure(usage, { ...deepseek, at: Date.UTC(2026, 10, 16, 2, 0) });
  assert.equal(peak.cost.amount, 0.2436);
  assert.equal(peak.cost.period, "peak");
  assert.equal(peak.cost.rule_date, "2026-11-14");
  const plain = measure(usage, { ...deepseek, at: Date.UTC(2026, 10, 16, 5, 0) });
  assert.equal(plain.cost.amount, 0.1218);
  assert.equal(plain.cost.period, "offpeak");
  assert.equal(
    measure(usage, { ...deepseek, at: Date.UTC(2026, 10, 14, 2, 0) }).cost.period,
    "offpeak",
  );
  assert.equal(
    measure(usage, { ...deepseek, at: Date.UTC(2026, 10, 16, 1, 0) }).cost.period,
    "peak",
  );
  assert.equal(
    measure(usage, { ...deepseek, at: Date.UTC(2026, 10, 16, 4, 0) }).cost.period,
    "offpeak",
  );
  assert.equal(
    measure(
      {
        prompt_tokens: 1000000,
        prompt_tokens_details: { cached_tokens: 600000 },
        completion_tokens: 100000,
      },
      { ...deepseek, protocol: "chat-completions", at: Date.UTC(2026, 10, 16, 2, 0) },
    ).cost.amount,
    0.2436,
  );
});

test("时间型规则的输入输出按所选时段单价计费", () => {
  const usage = { input_tokens: 1000000, output_tokens: 1000000 };
  const deepseek = {
    ...target,
    model: "deepseek-flash",
    url: "https://api.deepseek.com/v1/responses",
  };
  assert.equal(measure(usage, { ...deepseek, at: Date.UTC(2026, 10, 16, 2, 0) }).cost.amount, 1.5);
  assert.equal(measure(usage, { ...deepseek, at: Date.UTC(2026, 10, 16, 5, 0) }).cost.amount, 0.75);
});
