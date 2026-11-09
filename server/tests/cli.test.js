import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ask from "../scripts/ask.js";
import { defaults, paths } from "../config.js";
import openDB from "../db.js";
import { message } from "../ai/index.js";
import modelServer from "./model.js";

test("CLI ask 使用同一内核保存会话、消息和 usage", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic-cli-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const locations = paths({ AGENT_HOME: root });
  const usage = { input_tokens: 5, output_tokens: 2, total_tokens: 7 };
  const url = await modelServer(t, (request) => {
    assert.equal(request.input.at(-1).content[0].text, "终端问题");
    return { output: [message("回答", "output_text", "assistant")], usage };
  });
  const config = { ...defaults(), url, key: "test" };
  const written = [];
  const write = process.stdout.write;
  process.stdout.write = (chunk) => {
    written.push(String(chunk));
    return true;
  };
  let result;
  try {
    result = await ask("终端问题", config, { locations });
  } finally {
    process.stdout.write = write;
  }
  assert.equal(result.status, "completed");
  assert.equal(written.join(""), "回答\n");

  const db = openDB(locations.db);
  t.after(() => db.close());
  const sessions = db.prepare("SELECT * FROM sessions").all();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].id, result.session_id);
  const messages = db
    .prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY id")
    .all(result.session_id);
  assert.equal(messages.length, 2);
  assert.equal(JSON.parse(messages[0].item).role, "user");
  assert.equal(messages[0].usage, null);
  assert.equal(JSON.parse(messages[1].item).role, "assistant");
  assert.deepEqual(JSON.parse(messages[1].usage), usage);
});
