import { marked } from "marked";
const renderer = new marked.Renderer();
renderer.html = () => "";
const badUrl = (url: unknown) => /^\s*(javascript|data|vbscript):/i.test(String(url || ""));
const baseLink = renderer.link.bind(renderer);
renderer.link = (token) => {
  if (badUrl(token.href)) {
    token.href = "#";
  }
  return baseLink(token);
};
const baseImage = renderer.image.bind(renderer);
renderer.image = (token) => {
  if (badUrl(token.href)) {
    token.href = "";
  }
  return baseImage(token);
};
marked.setOptions({ breaks: true, gfm: true, renderer });
export const renderMd = (value: unknown) => marked.parse(String(value || "")) as string;
export function fmtArgs(value: unknown) {
  const { summary: _summary, ...rest } = (
    value && typeof value === "object" ? value : {}
  ) as Record<string, unknown>;
  try {
    return JSON.stringify(rest, null, 2);
  } catch {
    return String(value);
  }
}
export function fmtResult(value: unknown) {
  if (value == null || value === "") {
    return "";
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  const text = String(value);
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
