import { defaults } from "../config.js";

export function configured(connection = {}, settings = {}) {
  const main = {
    id: "main",
    name: "测试模型",
    model: "gpt-4o-mini",
    url: "http://model.invalid/v1/responses",
    key: "test-model-key",
    protocol: "responses",
    context_window: 0,
    ...connection,
  };
  return {
    ...defaults(),
    models: [main, { ...main, id: "compact", name: "摘要模型", model: "gpt-4o-mini" }],
    ...settings,
  };
}

export function selectedInput(data, modelId = "main", compactModelId = "compact") {
  return { model_id: modelId, compact_model_id: compactModelId, ...data };
}
