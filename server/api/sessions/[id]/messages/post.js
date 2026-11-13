import fs from "node:fs/promises";
import path from "node:path";
import { saveImage } from "../../../../images.js";
import { validAttachmentName, saveAttachment, removeAttachment } from "../../../../attachments.js";
import { run } from "../../../../agent/index.js";
import { message } from "../../../../ai/index.js";
import { runConfig } from "../../../../config.js";
import { withCost } from "../../../../metering/index.js";
import {
  createRunRecorder,
  loadContext,
  messagePreview,
  saveUserMessage,
} from "../../../../session.js";
import { body, fail, json } from "../../../http.js";
import { createReply } from "../../../../replies.js";

export default async function post(req, res, context, id) {
  const db = context.db;
  const active = context.replies;
  const {
    text,
    images = [],
    attachments = [],
    model_id,
    compact_model_id,
  } = await body(
    req,
    ["text", "images", "attachments", "model_id", "compact_model_id"],
    70 * 1024 * 1024,
  );
  if (typeof text !== "string" || Buffer.byteLength(text) > 128 * 1024) {
    fail(400, "text 必须是字符串且不能超过 128 KiB");
  }
  if (!Array.isArray(images) || images.length > 5) {
    fail(400, "每条消息最多发送 5 张图片");
  }
  if (!Array.isArray(attachments) || images.length + attachments.length > 5) {
    fail(400, "每条消息最多发送 5 个附件");
  }
  if (!text.trim() && images.length === 0 && attachments.length === 0) {
    fail(400, "请输入文字或添加附件");
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
  const files = [];
  let total = uploads.reduce((size, upload) => size + upload.bytes.length, 0);
  for (const file of attachments) {
    if (
      !file ||
      typeof file !== "object" ||
      Object.keys(file).some((key) => !["name", "data"].includes(key)) ||
      !validAttachmentName(file.name) ||
      typeof file.data !== "string"
    ) {
      fail(400, "附件名称或内容无效");
    }
    const match =
      /^data:([A-Za-z0-9!#$&^_.+\-]+\/[A-Za-z0-9!#$&^_.+\-]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
        file.data,
      );
    if (!match) {
      fail(400, "附件必须是 Base64 Data URL");
    }
    const bytes = Buffer.from(match[2], "base64");
    if (!bytes.length || bytes.toString("base64") !== match[2]) {
      fail(400, "附件内容或编码无效");
    }
    if (bytes.length > 25 * 1024 * 1024) {
      fail(413, "单个附件不能超过 25 MiB");
    }
    total += bytes.length;
    files.push({ name: file.name, type: match[1], bytes });
  }
  if (total > 50 * 1024 * 1024) {
    fail(413, "每条消息的附件总计不能超过 50 MiB");
  }
  let selected;
  try {
    selected = runConfig(context.config, model_id, compact_model_id);
  } catch (error) {
    fail(400, error.message);
  }
  const session = db
    .prepare(
      `
    SELECT sessions.*, (
      SELECT item FROM messages WHERE session_id = sessions.id ORDER BY id LIMIT 1
    ) AS first, (SELECT meta FROM messages WHERE session_id = sessions.id ORDER BY id LIMIT 1) AS first_meta FROM sessions WHERE id = ?
  `,
    )
    .get(id);
  if (!session) {
    fail(404, "会话不存在");
  }
  if (active.get(id)?.running) {
    fail(409, "会话正在回复");
  }
  const config = { ...selected, images_dir: context.paths.images, run_images: new Set() };
  const reply = createReply((runId, event) => {
    context.events.publish({ session_id: id, run_id: runId, event });
  });
  const controller = reply.controller;
  active.set(id, reply);
  const timer = setTimeout(
    () => controller.abort(new DOMException("回复超时", "TimeoutError")),
    config.run_timeout * 1000,
  );
  const emit = reply.publish;
  const savedAttachments = [];
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
    for (const file of files) {
      savedAttachments.push(
        await saveAttachment(
          context.paths.attachments,
          file.name,
          file.type,
          file.bytes,
          controller.signal,
        ),
      );
    }
    controller.signal.throwIfAborted();
    const savedUser = saveUserMessage(
      db,
      { sessionId: id },
      user.item,
      config.workdir,
      user.created_at,
      savedAttachments,
      config.model_id,
      config.compact_connection.id,
    );
    user.id = savedUser.id;
    // 用户消息已提交，即使随后停止或模型失败，也要保留其图片。
    config.run_images.clear();
    savedAttachments.length = 0;
    const preview = session.first
      ? messagePreview(JSON.parse(session.first), JSON.parse(session.first_meta || "null"))
      : messagePreview(user.item, savedUser.meta);

    // 找到最近一条模型输出、最新摘要和后续消息；压缩边界与数据库 ID 一一对应。
    const { messages, messageIds, usage, metering, lastResponseAt } = loadContext(db, {
      sessionId: id,
    });
    const recorder = createRunRecorder(db, { sessionId: id }, messageIds, preview, 1);
    const confirmation = {
      type: "message",
      item: user.item,
      meta: savedUser.meta,
      sequence: sequence++,
      created_at: user.created_at,
      saved: [
        {
          sequence: 0,
          id: user.id,
          meta: savedUser.meta,
          usage: null,
          metering: null,
          created_at: user.created_at,
        },
      ],
      session: {
        id,
        title: session.title,
        preview,
        running: true,
        created_at: session.created_at,
        updated_at: user.created_at,
        cost: withCost(session).cost,
        request_count: session.request_count,
      },
    };
    emit(confirmation);
    const acceptedCursor = context.events.cursor;
    void executeReply(
      context,
      id,
      reply,
      config,
      preview,
      recorder,
      {
        messages,
        usage,
        metering,
        lastResponseAt,
      },
      timer,
    );
    return json(res, 202, {
      epoch: context.events.epoch,
      cursor: acceptedCursor,
      run_id: reply.id,
      message: { ...user, meta: savedUser.meta },
      session: confirmation.session,
    });
  } catch (error) {
    clearTimeout(timer);
    for (const imageURL of config.run_images) {
      await fs.rm(path.join(context.paths.images, path.basename(imageURL)), { force: true });
    }
    for (const file of savedAttachments) {
      await removeAttachment(context.paths.attachments, file.url);
    }
    active.delete(id);
    reply.finish();
    throw error;
  }
}

async function executeReply(context, id, reply, config, preview, recorder, history, timer) {
  const db = context.db;
  const controller = reply.controller;
  const emit = reply.publish;
  let errorSent = false;
  let terminal = { type: "done", status: "completed" };
  try {
    // 业务层准备完整指令，Agent 只负责透传。
    const instructions = config.system;
    // 业务层组装上下文，Agent 负责循环；事件回调负责保存并转发。
    await run({
      instructions,
      messages: history.messages,
      model: config.model,
      compactModel: config.compact_connection.model,
      config,
      usage: history.usage,
      metering: history.metering,
      lastResponseAt: history.lastResponseAt,
      taskContext: {
        manager: context.tasks,
        sessionId: id,
        modelId: config.model_id,
        compactModelId: config.compact_connection.id,
      },
      signal: controller.signal,
      onEvent: (event) => {
        switch (event.type) {
          case "error":
            errorSent = true;
            emit(event);
            return;
          case "done":
            terminal = event;
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
        if (record.session) {
          outgoing.session = record.session;
        }
        if (record.saved) {
          // COMMIT 成功后才通知前端接管真实 ID；失败不能确认任何一条。
          outgoing.saved = record.saved;
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
    let status = "incomplete";
    const stopReason = error.code || "api_error";
    if (controller.signal.aborted && controller.signal.reason?.name !== "TimeoutError") {
      status = "aborted";
    } else if (!errorSent) {
      emit({ type: "error", code: stopReason, error: error.message });
    }
    terminal = { type: "done", status, stopReason };
  } finally {
    clearTimeout(timer);
    try {
      await context.tasks.cancelChildren({ sessionId: id });
      if (controller.signal.aborted) {
        await context.tasks.shell.cancelScope({ sessionId: id });
      }
      for (const imageURL of config.run_images) {
        await fs.rm(path.join(context.paths.images, path.basename(imageURL)), { force: true });
      }
    } catch (error) {
      emit({ type: "error", code: "cleanup_error", error: error.message });
      terminal = { type: "done", status: "incomplete", stopReason: "cleanup_error" };
    }
    // 清理完成才发布终止状态，收到 done 后可立即开始下一轮。
    reply.finish();
    emit({
      ...terminal,
      session: {
        ...withCost(db.prepare("SELECT * FROM sessions WHERE id = ?").get(id)),
        preview,
        running: false,
      },
    });
  }
}
