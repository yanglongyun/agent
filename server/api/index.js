import auth from "./auth/index.js";
import authorize from "./auth/authorize.js";
import sessions from "./sessions/index.js";
import notes from "./notes/index.js";
import config from "./config/index.js";
import status from "./status/index.js";
import images from "./images/index.js";
import attachments from "./attachments/index.js";
import processes from "./processes/index.js";
import tasks from "./tasks/index.js";
import events from "./events/index.js";
import logs from "./logs/index.js";
import { createEvents } from "../events.js";
import { createTaskManager } from "../tasks.js";
import { fail } from "./http.js";

export default function createApi(context) {
  // 会话拥有回复；连接只订阅事件，最后一次终止结果保留到下次回复或删除。
  context.replies = new Map();
  context.events = createEvents();
  context.tasks = createTaskManager(context.db, context.paths);

  async function route(req, res, parts) {
    const name = parts[0];
    const rest = parts.slice(1);
    if (name === "auth") {
      return auth(req, res, rest, context);
    }
    authorize(req, context);

    switch (name) {
      case "events":
        return events(req, res, rest, context);
      case "processes":
        return processes(req, res, rest, context);
      case "tasks":
        return tasks(req, res, rest, context);
      case "sessions":
        return sessions(req, res, rest, context);
      case "notes":
        return notes(req, res, rest, context);
      case "logs":
        return logs(req, res, rest, context);
      case "config":
        return config(req, res, rest, context);
      case "status":
        return status(req, res, rest, context);
      case "attachments":
        return attachments(req, res, rest, context);
      case "images":
        return images(req, res, rest, context);
      default:
        fail(404, "接口不存在");
    }
  }

  async function close() {
    context.events.close();
    const requests = [...context.replies.values()].filter((reply) => reply.running);
    for (const request of requests) {
      request.controller.abort();
    }
    await context.tasks.close();
    await Promise.all(requests.map((request) => request.done));
  }

  return { route, close };
}
