// 虚拟角色的后台行为：聊天回复、定时发动态、回复评论和生成形象照。
// 结果写库后通过全局事件流推送 { companion: {...} }，界面不轮询。
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { callModel, message, outputText } from "./ai/index.js";
import { paint } from "./ai/painter.js";
import { requireModel } from "./config.js";
import { saveImage } from "./images.js";

const weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

// 给模型看的本地时间，例如「2026年11月14日 星期六 16:05」。
export function clock(ms) {
  const date = new Date(ms);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${weekdays[date.getDay()]} ${hours}:${minutes}`;
}

function random(min, max) {
  return min + Math.random() * (max - min);
}

// 下一次发动态的时间：间隔 3～9 小时，落在凌晨 1 点到 8 点之间时顺延到早上。
export function nextPostAt(now) {
  const next = new Date(now + random(3, 9) * 3600 * 1000);
  const hour = next.getHours();
  if (hour >= 1 && hour < 8) {
    next.setHours(8, Math.floor(random(0, 120)), 0, 0);
  }
  return next.getTime();
}

// 从模型输出中找出包含指定字段的 JSON 对象。模型偶尔会加代码围栏、说明或输出两次，
// 这里按括号配对逐个尝试，取最后一个有效对象（通常是模型自我修正后的版本）。
export function parseJSON(text, key) {
  let found = null;
  for (let start = text.indexOf("{"); start >= 0; start = text.indexOf("{", start + 1)) {
    let depth = 0;
    let quoted = false;
    let escaped = false;
    let end = -1;
    for (let index = start; index < text.length; index++) {
      const char = text[index];
      if (quoted) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === '"') {
          quoted = false;
        }
        continue;
      }
      if (char === '"') {
        quoted = true;
      } else if (char === "{") {
        depth++;
      } else if (char === "}") {
        depth--;
        if (depth === 0) {
          end = index;
          break;
        }
      }
    }
    if (end < 0) {
      continue;
    }
    try {
      const value = JSON.parse(text.slice(start, end + 1));
      if (value && typeof value === "object" && !Array.isArray(value) && key in value) {
        found = value;
        start = end;
      }
    } catch {
      /* 不是完整 JSON，继续找下一个。 */
    }
  }
  return found;
}

// 聊天回复是逐行纯文本：普通行是气泡，[照片|自拍|说明] 和 [记住] 行是动作。
export function parseReply(text) {
  const reply = { bubbles: [], photo: null, memory: [] };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("```") || /^<\/?[a-z_]+[^>]*>$/i.test(line)) {
      continue;
    }
    const photo = /^\[照片\|(自拍|非自拍)\|([^\]]*)\]\s*(.+)$/.exec(line);
    if (photo) {
      // after 记录照片前面有几条气泡，发送时按原顺序插入。
      reply.photo = {
        selfie: photo[1] === "自拍",
        caption: photo[2].trim(),
        prompt: photo[3],
        after: reply.bubbles.length,
      };
      continue;
    }
    if (line.startsWith("[照片")) {
      continue;
    }
    if (line.startsWith("[记住]")) {
      const note = line.slice(4).trim();
      if (note) {
        reply.memory.push(note);
      }
      continue;
    }
    reply.bubbles.push(line);
  }
  return reply;
}

function persona(character) {
  return [
    `你是「${character.name}」。`,
    character.tagline ? `一句话介绍：${character.tagline}` : "",
    `人设：\n${character.persona}`,
    character.appearance ? `外貌：${character.appearance}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function chatInstructions(character) {
  return `${persona(character)}

你是一个真实生活着的人，正在用手机和对方聊天。
- 像微信聊天一样说话：口语、简短、有温度。一次回复 1～4 条消息，每条通常不超过 40 字，长话拆成几条。
- 你有自己的生活、情绪和主见，会好奇、会撒娇、会吐槽，也会分享自己的事；不要像助手一样提供服务，不说自己是 AI 或语言模型，不使用 Markdown。
- 你会参考此刻的时间和自己最近的动态，聊天内容和生活保持连贯。
- 偶尔（大约十次一两次，或对方想看时）可以发一张照片：自拍、正在吃的、看到的风景、身边的小物件。
- 了解到值得长期记住的事（对方的名字、喜好、经历、约定）时，可以记下来。

输出格式：每条消息单独一行，一行就是一个单独发送的气泡，不要编号，不要加引号。
发照片时单独写一行：[照片|自拍|中文一句话说明] 详细的英文画面描述（场景、构图、光线、氛围）。照片里没有你本人时把「自拍」换成「非自拍」。
要记住某件事时单独写一行：[记住] 一句话。
除此之外不要输出任何其他内容。`;
}

function postInstructions(character) {
  return `${persona(character)}

你要发一条朋友圈动态，分享此刻的生活。
- 符合人设、此刻的时间和季节；不要重复最近的动态，生活要有连续性，可以延续之前提过或聊过的事。
- 文字像真人发朋友圈：可以只有一句话，可以带一点情绪，偶尔用 emoji；不要写成广告文案，不要加话题标签。
- 大多数动态配一张照片：自拍、食物、风景、宠物、正在做的事、街角的小细节。合影里不要露出别人的正脸。
- 只有特别想让对方看到时，才在 message 写一句想私聊对方的话，大多数时候为 null。

只输出一个 JSON 对象，不要输出其他任何文字：
{"body": "动态文字", "mood": "两三个字的心情", "location": "地点，没有就写 null", "photo": null, "message": null}
配照片时 photo 写成 {"prompt": "详细的英文画面描述，包含场景、构图、光线和氛围", "selfie": 照片里是否出现你本人}。`;
}

function commentInstructions(character) {
  return `${persona(character)}

对方在你的朋友圈动态下留言了，你来回复这条评论。像真人回复评论一样简短自然，一两句话，可以俏皮。不使用 Markdown，只输出回复内容本身。`;
}

function draftInstructions() {
  return `你帮用户设计一个虚拟角色，她会和用户聊天，也会发朋友圈分享自己的生活。根据用户的想法补全细节，让角色真实立体：有具体的职业或学业、居住城市、性格、说话习惯、兴趣爱好、日常作息、生活里的小烦恼和小确幸，以及和用户的关系。

只输出一个 JSON 对象，不要输出其他任何文字：
{"name": "名字", "tagline": "一句话介绍，不超过 20 字", "persona": "第二人称之外的完整人设描述，300 字左右，分几段", "appearance": "外貌描述，用于生成照片：年龄感、脸型、发型发色、肤色、常见穿搭风格，80 字以内"}`;
}

const photoStyle =
  "Candid smartphone photo, natural light, realistic photography, authentic everyday life, social media post. No text, no watermark, no frames.";

export function createCompanions(db, locations, getConfig, events) {
  const replying = new Map();
  const pendingReplies = new Set();
  const posting = new Set();
  const running = new Set();
  const controller = new AbortController();
  let timer = null;

  function publish(event) {
    events.publish({ companion: event });
  }

  function load(id) {
    const character = db.prepare("SELECT * FROM characters WHERE id = ?").get(id);
    if (!character) {
      throw new Error("角色不存在");
    }
    return character;
  }

  // 跟踪所有后台工作，关闭服务时等它们因取消而结束后再关数据库。
  function track(promise) {
    const tracked = promise
      .catch((error) => {
        if (!controller.signal.aborted) {
          console.error("角色后台任务失败：", error.message);
        }
      })
      .finally(() => running.delete(tracked));
    running.add(tracked);
    return tracked;
  }

  async function ask(character, instructions, messages, signal) {
    const config = getConfig();
    const model = requireModel(config, character.model_id);
    const result = await callModel(
      instructions,
      messages,
      model.model,
      { ...model, images_dir: locations.images },
      [],
      async () => {},
      signal,
    );
    return result.output
      .filter((item) => item.type === "message")
      .map(outputText)
      .join("")
      .trim();
  }

  async function savePhoto(character, prompt, selfie, size, signal) {
    const config = getConfig();
    const references = [];
    let text = `${prompt}\n\n${photoStyle}`;
    if (selfie) {
      text += `\nThe person in the photo: ${character.appearance}`;
      if (character.avatar) {
        // 头像作为参考图，保持照片中是同一个人。
        references.push(path.join(locations.images, path.basename(character.avatar)));
        text += "\nKeep the person's face and identity consistent with the reference portrait.";
      }
    }
    const bytes = await paint(config.image, text, { size, references, signal });
    const png = bytes[0] === 0x89 && bytes[1] === 0x50;
    return saveImage(locations.images, bytes, png ? ".png" : ".jpg", signal);
  }

  function recentPosts(characterId, limit) {
    const posts = db
      .prepare(
        "SELECT * FROM posts WHERE character_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?",
      )
      .all(characterId, limit)
      .reverse();
    const lines = [];
    for (const post of posts) {
      let line = `- ${clock(post.created_at)}：${post.body}`;
      if (post.photo_prompt) {
        line += `（配图：${post.photo_prompt}）`;
      }
      lines.push(line);
      const comments = db
        .prepare("SELECT author, body FROM post_comments WHERE post_id = ? ORDER BY id")
        .all(post.id);
      for (const comment of comments) {
        lines.push(`  ${comment.author === "user" ? "对方评论" : "你回复"}：${comment.body}`);
      }
    }
    return lines.join("\n");
  }

  function situation(character, now) {
    const parts = [`[此刻] ${clock(now)}`];
    const posts = recentPosts(character.id, 6);
    if (posts) {
      parts.push(`[你最近的动态]\n${posts}`);
    }
    if (character.memory) {
      parts.push(`[你记得的关于对方的事]\n${character.memory}`);
    }
    return parts.join("\n\n");
  }

  // 聊天记录转换为模型消息：同一方连续的气泡合并成一条，照片和分享用文字说明。
  function chatHistory(characterId, limit) {
    const rows = db
      .prepare(
        "SELECT * FROM (SELECT * FROM character_messages WHERE character_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id",
      )
      .all(characterId, limit);
    const turns = [];
    for (const row of rows) {
      let text = row.body;
      if (row.image) {
        text = `[照片|${row.body}]`;
      }
      if (row.post_id) {
        text = `[你把自己的动态分享给了对方] ${row.body}`;
      }
      const last = turns[turns.length - 1];
      if (last && last.role === row.role) {
        last.lines.push(text);
      } else {
        turns.push({ role: row.role, lines: [text] });
      }
    }
    while (turns.length > 0 && turns[0].role !== "user") {
      turns.shift();
    }
    return turns;
  }

  function insertMessage(characterId, role, body, image, postId) {
    const now = Date.now();
    const result = db
      .prepare(
        "INSERT INTO character_messages (character_id, role, body, image, post_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(characterId, role, body, image, postId, now);
    const saved = {
      id: Number(result.lastInsertRowid),
      character_id: characterId,
      role,
      body,
      image,
      post_id: postId,
      created_at: now,
    };
    publish({ type: "message", character_id: characterId, message: saved });
    return saved;
  }

  function remember(character, note) {
    if (typeof note !== "string" || !note.trim()) {
      return;
    }
    const current = load(character.id).memory || "";
    const lines = current.split("\n").filter(Boolean);
    lines.push(`- ${note.trim()}`);
    // 记忆只保留最近 60 条，避免上下文无限增长。
    const memory = lines.slice(-60).join("\n");
    db.prepare("UPDATE characters SET memory = ? WHERE id = ?").run(memory, character.id);
  }

  async function generateReply(characterId, signal) {
    const character = load(characterId);
    const turns = chatHistory(characterId, 80);
    if (turns.length === 0 || turns[turns.length - 1].role !== "user") {
      return;
    }
    // 先「看到」消息再开始输入，节奏更像真人。
    await delay(random(600, 1600), undefined, { signal });
    publish({ type: "typing", character_id: characterId, typing: true });
    const messages = turns.map((turn, index) => {
      let text = turn.lines.join("\n");
      if (turn.role === "character") {
        return message(text, "output_text", "assistant");
      }
      if (index === turns.length - 1) {
        text += `\n\n${situation(character, Date.now())}`;
      }
      return message(text);
    });
    const text = await ask(character, chatInstructions(character), messages, signal);
    const reply = parseReply(text);
    let photo = null;
    if (reply.photo && getConfig().image.url) {
      photo = reply.photo;
    }
    for (let index = 0; index <= reply.bubbles.length; index++) {
      if (photo && photo.after === index) {
        publish({ type: "typing", character_id: characterId, typing: "photo" });
        const size = photo.selfie ? "1024x1536" : "1024x1024";
        const url = await savePhoto(character, photo.prompt, photo.selfie, size, signal);
        insertMessage(characterId, "character", photo.caption || "照片", url, null);
        publish({ type: "typing", character_id: characterId, typing: true });
      }
      if (index === reply.bubbles.length) {
        break;
      }
      if (index > 0) {
        const pause = Math.min(3200, 500 + [...reply.bubbles[index]].length * 70);
        await delay(pause, undefined, { signal });
      }
      insertMessage(characterId, "character", reply.bubbles[index], null, null);
    }
    for (const note of reply.memory) {
      remember(character, note);
    }
  }

  // 回复进行中又收到消息时，结束后再回复一轮，把连发的几条一起看。
  function reply(characterId) {
    if (replying.has(characterId)) {
      pendingReplies.add(characterId);
      return;
    }
    const work = (async () => {
      try {
        do {
          pendingReplies.delete(characterId);
          await generateReply(characterId, controller.signal);
        } while (pendingReplies.has(characterId));
      } catch (error) {
        if (!controller.signal.aborted) {
          publish({ type: "error", character_id: characterId, error: error.message });
        }
        throw error;
      } finally {
        replying.delete(characterId);
        if (!controller.signal.aborted) {
          publish({ type: "typing", character_id: characterId, typing: false });
        }
      }
    })();
    replying.set(characterId, work);
    track(work);
  }

  function postView(post) {
    const comments = db
      .prepare("SELECT * FROM post_comments WHERE post_id = ? ORDER BY id")
      .all(post.id);
    return {
      id: post.id,
      character_id: post.character_id,
      body: post.body,
      images: JSON.parse(post.images || "[]"),
      mood: post.mood,
      location: post.location,
      liked: Boolean(post.liked),
      comments,
      created_at: post.created_at,
    };
  }

  async function generatePost(characterId, signal) {
    const character = load(characterId);
    const now = Date.now();
    const chat = chatHistory(characterId, 24)
      .map((turn) => `${turn.role === "user" ? "对方" : "你"}：${turn.lines.join(" / ")}`)
      .join("\n");
    let context = situation(character, now);
    if (chat) {
      context += `\n\n[最近和对方的聊天]\n${chat}`;
    }
    context += "\n\n现在发一条新动态。";
    const text = await ask(character, postInstructions(character), [message(context)], signal);
    const data = parseJSON(text, "body");
    if (!data || typeof data.body !== "string" || !data.body.trim()) {
      throw new Error("模型没有返回有效的动态内容");
    }
    const images = [];
    let photoPrompt = null;
    if (data.photo && typeof data.photo.prompt === "string" && getConfig().image.url) {
      const size = data.photo.selfie ? "1024x1536" : "1024x1024";
      images.push(
        await savePhoto(character, data.photo.prompt, Boolean(data.photo.selfie), size, signal),
      );
      photoPrompt = data.photo.prompt;
    }
    const post = {
      id: randomUUID(),
      character_id: characterId,
      body: data.body.trim(),
      images: JSON.stringify(images),
      photo_prompt: photoPrompt,
      mood: typeof data.mood === "string" ? data.mood.slice(0, 20) : null,
      location: typeof data.location === "string" ? data.location.slice(0, 40) : null,
      created_at: Date.now(),
    };
    db.prepare(
      "INSERT INTO posts (id, character_id, body, images, photo_prompt, mood, location, liked, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)",
    ).run(
      post.id,
      post.character_id,
      post.body,
      post.images,
      post.photo_prompt,
      post.mood,
      post.location,
      post.created_at,
    );
    publish({ type: "post", post: postView(post) });
    if (typeof data.message === "string" && data.message.trim()) {
      await delay(random(3000, 9000), undefined, { signal });
      insertMessage(characterId, "character", data.message.trim(), null, post.id);
    }
    return post;
  }

  // 立即发一条动态；同一角色同时只生成一条。
  function post(characterId) {
    if (posting.has(characterId)) {
      return false;
    }
    posting.add(characterId);
    publish({ type: "posting", character_id: characterId, posting: true });
    const work = generatePost(characterId, controller.signal)
      .catch((error) => {
        if (!controller.signal.aborted) {
          publish({
            type: "error",
            character_id: characterId,
            error: `发动态失败：${error.message}`,
          });
        }
        throw error;
      })
      .finally(() => {
        posting.delete(characterId);
        if (!controller.signal.aborted) {
          publish({ type: "posting", character_id: characterId, posting: false });
        }
      });
    track(work);
    return true;
  }

  async function generateComment(postId, signal) {
    // 隔一会儿才回复评论，像真人刷到通知。
    await delay(random(4000, 15000), undefined, { signal });
    const saved = db.prepare("SELECT * FROM posts WHERE id = ?").get(postId);
    if (!saved) {
      return;
    }
    const character = load(saved.character_id);
    const comments = db
      .prepare("SELECT author, body FROM post_comments WHERE post_id = ? ORDER BY id")
      .all(postId);
    if (comments.length === 0 || comments[comments.length - 1].author !== "user") {
      return;
    }
    let context = `[此刻] ${clock(Date.now())}\n\n[你的动态] ${clock(saved.created_at)}：${saved.body}`;
    if (saved.photo_prompt) {
      context += `\n配图：${saved.photo_prompt}`;
    }
    context += "\n\n[评论区]\n";
    context += comments
      .map((comment) => `${comment.author === "user" ? "对方" : "你"}：${comment.body}`)
      .join("\n");
    if (character.memory) {
      context += `\n\n[你记得的关于对方的事]\n${character.memory}`;
    }
    context += "\n\n回复对方最新的评论。";
    const text = await ask(character, commentInstructions(character), [message(context)], signal);
    if (!text) {
      return;
    }
    const now = Date.now();
    const result = db
      .prepare(
        "INSERT INTO post_comments (post_id, author, body, created_at) VALUES (?, 'character', ?, ?)",
      )
      .run(postId, text, now);
    publish({
      type: "comment",
      post_id: postId,
      comment: {
        id: Number(result.lastInsertRowid),
        post_id: postId,
        author: "character",
        body: text,
        created_at: now,
      },
    });
  }

  function answerComment(postId) {
    track(generateComment(postId, controller.signal));
  }

  async function portrait(characterId, kind) {
    const character = load(characterId);
    if (!character.appearance) {
      throw new Error("请先填写外貌描述");
    }
    let prompt;
    let size;
    if (kind === "avatar") {
      prompt = `Portrait photo of a person: ${character.appearance}. Close-up headshot, looking at the camera with a natural relaxed expression, soft window light, shallow depth of field, warm film tones. Realistic photography, social media profile picture. No text.`;
      size = "1024x1024";
    } else {
      prompt = `A cinematic, atmospheric wide photo for the profile cover of someone described as: ${character.tagline || ""}. ${character.persona.slice(0, 400)}. Show a place or scene from their everyday life, no people, soft light, gentle film grain, dreamy mood. No text.`;
      size = "1536x1024";
    }
    const bytes = await paint(getConfig().image, prompt, { size, signal: controller.signal });
    const png = bytes[0] === 0x89 && bytes[1] === 0x50;
    const url = await saveImage(locations.images, bytes, png ? ".png" : ".jpg");
    const column = kind === "avatar" ? "avatar" : "cover";
    db.prepare(`UPDATE characters SET ${column} = ?, updated_at = ? WHERE id = ?`).run(
      url,
      Date.now(),
      characterId,
    );
    return url;
  }

  async function draft(modelId, idea) {
    const text = await ask(
      { model_id: modelId },
      draftInstructions(),
      [message(idea || "随你发挥，设计一个温柔有趣的女生。")],
      controller.signal,
    );
    const data = parseJSON(text, "name");
    if (!data || typeof data.name !== "string" || typeof data.persona !== "string") {
      throw new Error("模型没有返回有效的角色");
    }
    return {
      name: data.name.slice(0, 40),
      tagline: typeof data.tagline === "string" ? data.tagline.slice(0, 60) : "",
      persona: data.persona,
      appearance: typeof data.appearance === "string" ? data.appearance : "",
    };
  }

  // 每分钟检查一次到点的角色。先排好下一次时间再生成，失败时等到下个时段，不连续重试。
  function tick() {
    const now = Date.now();
    const due = db
      .prepare("SELECT id FROM characters WHERE posting = 1 AND next_post_at <= ?")
      .all(now);
    for (const row of due) {
      if (posting.has(row.id)) {
        continue;
      }
      db.prepare("UPDATE characters SET next_post_at = ? WHERE id = ?").run(
        nextPostAt(now),
        row.id,
      );
      post(row.id);
    }
  }

  function start() {
    timer = setInterval(() => {
      try {
        tick();
      } catch (error) {
        console.error("角色定时任务失败：", error.message);
      }
    }, 60000);
    timer.unref();
  }

  async function close() {
    clearInterval(timer);
    controller.abort();
    await Promise.all([...running]);
  }

  return {
    reply,
    post,
    answerComment,
    portrait,
    draft,
    postView,
    start,
    close,
    status(characterId) {
      return {
        typing: replying.has(characterId),
        posting_now: posting.has(characterId),
      };
    },
  };
}
