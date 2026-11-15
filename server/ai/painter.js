// OpenAI 兼容的生图请求。没有参考图时走 generations，有参考图时走 edits 保持人物一致。
import fs from "node:fs/promises";
import path from "node:path";
import { boundedBody } from "./index.js";

export async function paint(image, prompt, { size = "1024x1024", references = [], signal } = {}) {
  if (!image.url) {
    throw new Error("请先在设置中填写生图接口");
  }
  const base = image.url.replace(/\/+$/, "");
  const headers = { authorization: `Bearer ${image.key}` };
  let response;
  // 生图通常需要十几秒到一分钟，单独给三分钟上限，并跟随调用方取消。
  const timeout = AbortSignal.timeout(180000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  if (references.length > 0) {
    const form = new FormData();
    form.append("model", image.model);
    form.append("prompt", prompt);
    form.append("size", size);
    form.append("quality", "medium");
    form.append("output_format", "jpeg");
    form.append("output_compression", "88");
    for (const filename of references) {
      const bytes = await fs.readFile(filename);
      const type = path.extname(filename) === ".png" ? "image/png" : "image/jpeg";
      form.append("image[]", new Blob([bytes], { type }), path.basename(filename));
    }
    response = await fetch(`${base}/images/edits`, {
      method: "POST",
      headers,
      body: form,
      signal: combined,
    });
  } else {
    response = await fetch(`${base}/images/generations`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        model: image.model,
        prompt,
        size,
        quality: "medium",
        output_format: "jpeg",
        output_compression: 88,
        n: 1,
      }),
      signal: combined,
    });
  }
  const raw = (await boundedBody(response, 64 * 1024 * 1024)).toString();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`生图接口返回无效内容：${raw.slice(0, 200)}`);
  }
  if (!response.ok) {
    throw new Error(
      `生图失败 HTTP ${response.status}：${data.error?.message || raw.slice(0, 200)}`,
    );
  }
  const encoded = data.data?.[0]?.b64_json;
  if (typeof encoded !== "string") {
    throw new Error("生图接口没有返回图片");
  }
  return Buffer.from(encoded, "base64");
}
