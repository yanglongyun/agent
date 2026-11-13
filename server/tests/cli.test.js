import { configured } from "./config-fixture.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ask from "../scripts/ask.js";
import { paths } from "../config.js";
import openDB from "../db.js";
import { message } from "../ai/index.js";
import modelServer from "./model.js";

test("CLI ask 使用同一内核保存会话、消息和 usage", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic-cli-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const locations = paths({ AGENT_HOME: root });
  const usage = { input_tokens: 5, output_tokens: 2, total_tokens: 7 };
  let instructions;
  let input;
  const url = await modelServer(t, (request) => {
    instructions = request.instructions;
    input = structuredClone(request.input);
    assert.equal(request.input.at(-1).content[0].text, "终端问题");
    return { output: [message("回答", "output_text", "assistant")], usage };
  });
  const config = {
    ...configured({ url, key: "test" }),
    api: { listen: "127.0.0.1:0", token: "test-cli-access-token" },
  };
  const written = [];
  const write = process.stdout.write;
  process.stdout.write = (chunk) => {
    written.push(String(chunk));
    return true;
  };
  let result;
  try {
    result = await ask("终端问题", config, {
      locations,
      workdir: root,
      modelId: "main",
      compactModelId: "compact",
    });
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
  assert.equal(instructions, config.system);
  assert.doesNotMatch(instructions, /\{\{\w+\}\}/);
  const messages = db
    .prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY id")
    .all(result.session_id);
  assert.equal(messages.length, 2);
  const user = JSON.parse(messages[0].item);
  assert.equal(user.role, "user");
  assert.deepEqual(user, message("终端问题"));
  const meta = JSON.parse(messages[0].meta);
  assert.equal(meta.environment.workdir, root);
  assert.equal(meta.environment.time, new Date(messages[0].created_at).toISOString());
  assert.equal(input[0].content.length, 2);
  assert.ok(input[0].content.at(-1).text.includes(meta.environment.time));
  assert.ok(input[0].content.at(-1).text.includes(root));
  assert.equal(messages[0].usage, null);
  assert.equal(JSON.parse(messages[1].item).role, "assistant");
  assert.deepEqual(JSON.parse(messages[1].usage), usage);
  const measurement = db.prepare("SELECT * FROM metering WHERE message_id = ?").get(messages[1].id);
  assert.equal(measurement.session_id, result.session_id);
  assert.equal(JSON.parse(measurement.measurement).context_tokens, 7);
});
