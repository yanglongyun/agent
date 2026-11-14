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
];
