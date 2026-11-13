export type ModelProtocol = "responses" | "chat-completions" | "anthropic-messages";

export interface ModelInfo {
  id: string;
  name: string;
  model: string;
  protocol: ModelProtocol;
  context_window: number;
}

export interface ModelSettings extends ModelInfo {
  url: string;
  key: string;
  key_set: boolean;
}

export const protocolNames = {
  responses: "OpenAI Responses",
  "chat-completions": "OpenAI Chat Completions",
  "anthropic-messages": "Claude Messages",
};

export const modelEndpoints = {
  responses: "https://api.openai.com/v1/responses",
  "chat-completions": "https://api.openai.com/v1/chat/completions",
  "anthropic-messages": "https://api.anthropic.com/v1/messages",
};
