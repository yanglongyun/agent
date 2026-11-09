import fs from "node:fs/promises";
import path from "node:path";
import { saveImage } from "../../../../images.js";
import { run } from "../../../../agent/index.js";
import { message } from "../../../../ai/index.js";
import { requireModel, renderPrompt } from "../../../../config.js";
import {
  createRunRecorder,
  loadContext,
  messagePreview,
  saveUserMessage,
} from "../../../../session.js";
import { body, fail, stream } from "../../../http.js";

export default async function post(req, res, context, id) {
  const db = context.db;
  const active = context.activeReplies;
  const { text, images = [] } = await body(req, ["text", "images"], 70 * 1024 * 1024);
  if (typeof text !== "string" || Buffer.byteLength(text) > 128 * 1024) {
    fail(400, "text 必须是字符串且不能超过 128 KiB");
  }
  if (!Array.isArray(images) || images.length > 5) {
    fail(400, "每条消息最多发送 5 张图片");
  }
  if (!text.trim() && images.length === 0) {
    fail(400, "请输入文字或选择图片");
  }
  // 先校验整批图片，再保存文件；Base64 只用于传输，不写入消息。
  const uploads = [];
  for (const image of images) {
    if (typeof image !== "string") {
      fail(400, "图片必须是 Data URL");
    }
    const match = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
    if (!match) {
      fail(400, "仅支持 PNG、JPEG、GIF、WebP 图片");
    }
    const bytes = Buffer.from(match[2], "base64");
    if (bytes.length > 10 * 1024 * 1024) {
      fail(413, "每张图片不能超过 10 MiB");
    }
    let type;
    if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      type = "png";
    } else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
      type = "jpeg";
    } else if (["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6))) {
      type = "gif";
    } else if (
      bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WEBP"
    ) {
      type = "webp";
    }
    if (type !== match[1] || bytes.toString("base64") !== match[2]) {
      fail(400, "图片内容或编码无效");
    }
    uploads.push({ bytes, extension: `.${type}` });
  }
  try {
    requireModel(context.config);
  } catch (error) {
    fail(400, error.message);
  }
  const session = db
    .prepare(
      `
    SELECT sessions.*, (
      SELECT item FROM messages WHERE session_id = sessions.id ORDER BY id LIMIT 1
    ) AS first FROM sessions WHERE id = ?
  `,
    )
    .get(id);
  if (!session) {
    fail(404, "会话不存在");
  }
  if (active.has(id)) {
    fail(409, "会话正在回复");
  }
  const config = { ...context.config, images_dir: context.paths.images, run_images: new Set() };
  const controller = new AbortController();
  let finish;
  const done = new Promise((resolve) => {
    finish = resolve;
  });
  active.set(id, { controller, done });
  // 上传文件时也响应页面断开，未提交的图片由 finally 清理。
  res.once("close", () => controller.abort());
  if (res.destroyed) {
    controller.abort();
  }
  const timer = setTimeout(
    () => controller.abort(new DOMException("回复超时", "TimeoutError")),
    config.run_timeout * 1000,
  );
  let emit;
  let errorSent = false;
  let doneSent = false;
  const first = session.first ? JSON.parse(session.first) : message(text);
  const preview = messagePreview(first) || "[图片]";
  let sequence = 0;
  try {
    // 先保存本次用户输入，下面查询上下文时会一起取出，不再重复追加。
    const user = {
      session_id: id,
      item: message(text),
      usage: null,
      created_at: Date.now(),
    };
    if (!text.trim()) {
      user.item.content = [];
    }
    for (const upload of uploads) {
      const imageURL = await saveImage(
        context.paths.images,
        upload.bytes,
        upload.extension,
        controller.signal,
      );
      config.run_images.add(imageURL);
      user.item.content.push({ type: "input_image", image_url: imageURL, detail: "auto" });
    }
    controller.signal.throwIfAborted();
    const savedUser = saveUserMessage(db, id, user.item, user.created_at);
    user.id = savedUser.id;
    // 用户消息已提交，即使随后停止或模型失败，也要保留其图片。
    config.run_images.clear();

    // 找到最近一条模型输出、最新摘要和后续消息；压缩边界与数据库 ID 一一对应。
    const { messages, messageIds, usage } = loadContext(db, id);
    const recorder = createRunRecorder(db, id, messageIds, preview, 1);
    emit = stream(res, controller);
    emit({
      type: "message",
      item: user.item,
      sequence: sequence++,
      created_at: user.created_at,
      saved: [{ sequence: 0, id: user.id, usage: null, created_at: user.created_at }],
      session: {
        id,
        title: session.title,
        preview,
        running: true,
        created_at: session.created_at,
        updated_at: user.created_at,
      },
    });
    // 业务层准备完整指令，Agent 只负责透传。
    const instructions = renderPrompt(config.system, config.workdir);
    // 业务层组装上下文，Agent 负责循环；事件回调负责保存并转发。
    await run({
      instructions,
      messages,
      model: config.model,
      config,
      usage,
      signal: controller.signal,
      onEvent: (event) => {
        switch (event.type) {
          case "error":
            errorSent = true;
            emit(event);
            return;
          case "done":
            doneSent = true;
            emit({
              ...event,
              session: {
                ...db.prepare("SELECT * FROM sessions WHERE id = ?").get(id),
                preview,
                running: false,
              },
            });
            return;
        }
        controller.signal.throwIfAborted();
        // API 的保存信息放在事件外层，Agent 的原始 item 保持不变。
        const outgoing = { ...event };
        const record = recorder.track(event);
        if (record.sequence !== undefined) {
          outgoing.sequence = record.sequence;
          outgoing.created_at = record.created_at;
        }
        if (record.compaction) {
          outgoing.compaction = record.compaction;
        }
        if (record.saved) {
          // COMMIT 成功后才通知前端接管真实 ID；失败不能确认任何一条。
          outgoing.saved = record.saved;
          outgoing.session = record.session;
          // 本轮图片已被完整消息引用，之后不再属于待清理文件。
          for (const item of record.savedItems || []) {
            if (item.type === "function_call_output" && Array.isArray(item.output)) {
              for (const part of item.output) {
                if (part.type === "input_image") {
                  config.run_images.delete(part.image_url);
                }
              }
            }
          }
        }
        emit(outgoing);
      },
    });
  } catch (error) {
    if (!emit) {
      throw error;
    }
    if (!doneSent) {
      let status = "incomplete";
      let stopReason = error.code || "api_error";
      if (controller.signal.aborted && controller.signal.reason?.name !== "TimeoutError") {
        status = "aborted";
        stopReason = "aborted";
      } else if (!errorSent) {
        emit({ type: "error", code: stopReason, error: error.message });
      }
      emit({
        type: "done",
        status,
        stopReason,
        session: {
          ...db.prepare("SELECT * FROM sessions WHERE id = ?").get(id),
          preview,
          running: false,
        },
      });
    }
  } finally {
    clearTimeout(timer);
    for (const imageURL of config.run_images) {
      try {
        await fs.rm(path.join(context.paths.images, path.basename(imageURL)), { force: true });
      } catch (error) {
        console.error("清理未保存图片失败：", error.message);
      }
    }
    active.delete(id);
    finish();
    if (emit && !res.destroyed) {
      res.end();
    }
  }
}
