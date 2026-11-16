// USD / 百万 token；每个规则按 checked 日期核对公开标价。
// 带 peak 的规则按 UTC 工作日时段区分高峰与平峰，其余规则全天同价。
export default [
  {
    model: "gpt-6-luna",
    protocols: ["responses", "chat-completions"],
    reference: "https://developers.openai.com/api/docs/pricing",
    currency: "USD",
    checked: "2026-11-10",
    rates: [
      { through: 272000, input: 0.1, output: 0.5, cached: 0.01, write: 0.125, write_long: 0.25 },
      { through: null, input: 0.2, output: 0.75, cached: 0.02, write: 0.25, write_long: 0.5 },
    ],
  },
  {
    model: "gpt-6.1-terra",
    protocols: ["responses", "chat-completions"],
    reference: "https://developers.openai.com/api/docs/pricing",
    currency: "USD",
    checked: "2026-11-10",
    rates: [
      { through: 272000, input: 1, output: 5, cached: 0.05, write: 1.25, write_long: 2.5 },
      { through: null, input: 2, output: 7.5, cached: 0.1, write: 2.5, write_long: 5 },
    ],
  },
  {
    model: "gpt-6.1-sol",
    protocols: ["responses", "chat-completions"],
    reference: "https://developers.openai.com/api/docs/pricing",
    currency: "USD",
    checked: "2026-11-10",
    rates: [
      { through: 272000, input: 2, output: 10, cached: 0.1, write: 2.5, write_long: 5 },
      { through: null, input: 4, output: 15, cached: 0.2, write: 5, write_long: 10 },
    ],
  },
  {
    model: "deepseek-flash",
    protocols: ["responses", "chat-completions"],
    reference: "https://api-docs.deepseek.com/quick_start/pricing",
    currency: "USD",
    checked: "2026-11-14",
    // 高峰为 UTC 周一至周五 01:00-04:00、06:00-10:00；中国法定假日未内置，按工作日计。
    peak: {
      weekdays: [1, 2, 3, 4, 5],
      hours: [
        [1, 4],
        [6, 10],
      ],
    },
    rates: [
      {
        period: "peak",
        through: null,
        input: 0.3,
        output: 1.2,
        cached: 0.006,
        write: 0,
        write_long: 0,
      },
      {
        period: "offpeak",
        through: null,
        input: 0.15,
        output: 0.6,
        cached: 0.003,
        write: 0,
        write_long: 0,
      },
    ],
  },
  {
    model: "claude-fable-5-2",
    protocols: ["anthropic-messages"],
    reference: "https://platform.claude.com/docs/en/about-claude/pricing",
    currency: "USD",
    checked: "2026-11-10",
    rates: [{ through: null, input: 8, output: 40, cached: 0.2, write: 10, write_long: 16 }],
  },
  {
    model: "claude-sonnet-5-5",
    protocols: ["anthropic-messages"],
    reference: "https://platform.claude.com/docs/en/about-claude/pricing",
    currency: "USD",
    checked: "2026-11-10",
    rates: [{ through: null, input: 2, output: 10, cached: 0.1, write: 2.5, write_long: 4 }],
  },
  {
    model: "claude-opus-5-5",
    protocols: ["anthropic-messages"],
    reference: "https://platform.claude.com/docs/en/about-claude/pricing",
    currency: "USD",
    checked: "2026-11-10",
    rates: [{ through: null, input: 4, output: 20, cached: 0.2, write: 5, write_long: 8 }],
  },
  {
    model: "gemini-4-hydrogen",
    protocols: ["chat-completions"],
    reference: "https://ai.google.dev/gemini-api/docs/pricing",
    currency: "USD",
    checked: "2026-11-15",
    // Gemini 只支持隐式缓存，没有缓存写入费；思考 token 计入输出价。
    rates: [{ through: null, input: 1.5, output: 7.5, cached: 0.075, write: 0, write_long: 0 }],
  },
  {
    model: "gemini-4-carbon",
    protocols: ["chat-completions"],
    reference: "https://ai.google.dev/gemini-api/docs/pricing",
    currency: "USD",
    checked: "2026-11-15",
    // 官方 2026-12-01 起价格翻倍；只有隐式缓存，没有缓存写入费。
    rates: [
      {
        from: "2026-12-01T00:00:00Z",
        through: null,
        input: 4,
        output: 20,
        cached: 0.2,
        write: 0,
        write_long: 0,
      },
      { through: null, input: 2, output: 10, cached: 0.1, write: 0, write_long: 0 },
    ],
  },
  {
    model: "gemini-4-argon",
    protocols: ["chat-completions"],
    reference: "https://ai.google.dev/gemini-api/docs/pricing",
    currency: "USD",
    checked: "2026-11-15",
    // 官方 2026-12-01 起价格翻倍；只有隐式缓存，没有缓存写入费。
    rates: [
      {
        from: "2026-12-01T00:00:00Z",
        through: null,
        input: 4,
        output: 20,
        cached: 0.2,
        write: 0,
        write_long: 0,
      },
      { through: null, input: 2, output: 10, cached: 0.1, write: 0, write_long: 0 },
    ],
  },
  // Kimi K3 系列官方以人民币标价（¥/MTok），按其当日汇率折成美元，原始价写在注释里便于复核。
  {
    model: "k3.1-pro",
    protocols: ["responses", "chat-completions"],
    reference: "https://platform.kimi.com/docs/pricing/chat",
    currency: "USD",
    checked: "2026-11-16",
    // 官方 ¥13 / ¥68 / ¥1.30 / ¥13 / ¥26（输入 / 输出 / 缓存命中 / 写入 5min / 写入 1h）；
    // 换算汇率 1 USD = 6.6784 CNY（2026-11-16）。自动缓存，无单独缓存写费档。
    rates: [
      {
        through: null,
        input: 1.9466,
        output: 10.1821,
        cached: 0.1947,
        write: 1.9466,
        write_long: 3.8931,
      },
    ],
  },
  {
    model: "k3",
    protocols: ["responses", "chat-completions"],
    reference: "https://platform.kimi.com/docs/pricing/chat",
    currency: "USD",
    checked: "2026-11-16",
    // 官方 ¥20 / ¥100 / ¥2.00 / ¥20 / ¥40（输入 / 输出 / 缓存命中 / 写入 5min / 写入 1h）；
    // 换算汇率 1 USD = 6.6784 CNY（2026-11-16）。
    rates: [
      {
        through: null,
        input: 2.9947,
        output: 14.9736,
        cached: 0.2995,
        write: 2.9947,
        write_long: 5.9895,
      },
    ],
  },
];
