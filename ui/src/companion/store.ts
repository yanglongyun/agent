// 角色应用的状态：角色列表、每个角色的聊天记录、动态流，以及正在输入 / 正在发动态的标记。
// 服务端通过全局事件流推送 { companion } 帧，这里直接合并，不轮询。
import { create } from "zustand";
import { api } from "../lib/api";
import { toast } from "../overlay/toast";
import type { CharacterDraft, Character, ChatMessage, CompanionEvent, Post } from "./types";

interface ChatState {
  messages: ChatMessage[];
  hasMore: boolean;
  loaded: boolean;
}

interface CompanionState {
  characters: Character[];
  loaded: boolean;
  error: string;
  chats: Record<string, ChatState>;
  typing: Record<string, boolean | "photo">;
  posting: Record<string, boolean>;
  posts: Post[];
  postsKey: string | null;
  postsMore: boolean;
  postsLoading: boolean;
  /** 正在生成头像或封面的角色，值是 avatar / cover。 */
  painting: Record<string, string>;
}

const useCompanion = create<CompanionState>(() => ({
  characters: [],
  loaded: false,
  error: "",
  chats: {},
  typing: {},
  posting: {},
  posts: [],
  postsKey: null,
  postsMore: false,
  postsLoading: false,
  painting: {},
}));
export { useCompanion };

const set = useCompanion.setState;
const get = useCompanion.getState;

function upsertCharacter(list: Character[], character: Character) {
  const rest = list.filter((item) => item.id !== character.id);
  return [character, ...rest].sort((a, b) => lastActive(b) - lastActive(a));
}

export function lastActive(character: Character) {
  return character.last_message?.created_at ?? character.created_at;
}

export async function loadCharacters() {
  try {
    const data = await api.get<{ characters: Character[] }>("/api/characters");
    const typing: Record<string, boolean> = {};
    const posting: Record<string, boolean> = {};
    for (const character of data.characters) {
      typing[character.id] = character.typing;
      posting[character.id] = character.posting_now;
    }
    set({ characters: data.characters, loaded: true, error: "", typing, posting });
  } catch (failure) {
    set({ loaded: true, error: failure instanceof Error ? failure.message : "读取失败" });
  }
}

export async function openChat(id: string) {
  const current = get().chats[id];
  if (current?.loaded) {
    return;
  }
  const data = await api.get<{ messages: ChatMessage[]; has_more: boolean }>(
    `/api/characters/${id}/messages`,
  );
  set((state) => ({
    chats: {
      ...state.chats,
      [id]: { messages: data.messages, hasMore: data.has_more, loaded: true },
    },
  }));
}

export async function loadOlderMessages(id: string) {
  const chat = get().chats[id];
  if (!chat || !chat.hasMore || chat.messages.length === 0) {
    return;
  }
  const data = await api.get<{ messages: ChatMessage[]; has_more: boolean }>(
    `/api/characters/${id}/messages?before=${chat.messages[0].id}`,
  );
  set((state) => {
    const latest = state.chats[id];
    return {
      chats: {
        ...state.chats,
        [id]: {
          ...latest,
          messages: [...data.messages, ...latest.messages],
          hasMore: data.has_more,
        },
      },
    };
  });
}

export async function sendMessage(id: string, body: string) {
  await api.post<ChatMessage>(`/api/characters/${id}/messages`, { body });
}

/** 读取动态流；characterId 为空时是所有角色的动态。 */
export async function loadPosts(characterId: string | null, more = false) {
  const key = characterId ?? "all";
  const state = get();
  if (state.postsLoading) {
    return;
  }
  let url = "/api/posts?";
  if (characterId) {
    url += `character_id=${encodeURIComponent(characterId)}&`;
  }
  if (more && state.postsKey === key && state.posts.length > 0) {
    url += `before=${state.posts[state.posts.length - 1].created_at}`;
  }
  set({ postsLoading: true });
  try {
    const data = await api.get<{ posts: Post[]; has_more: boolean }>(url);
    set((current) => ({
      posts: more && current.postsKey === key ? [...current.posts, ...data.posts] : data.posts,
      postsKey: key,
      postsMore: data.has_more,
      postsLoading: false,
    }));
  } catch (failure) {
    set({ postsLoading: false });
    toast(failure instanceof Error ? failure.message : "动态读取失败");
  }
}

export async function requestPost(id: string) {
  const result = await api.post<{ started: boolean }>(`/api/characters/${id}/posts`);
  if (!result.started) {
    toast("她正在发动态，稍等一下");
  }
}

export async function toggleLike(post: Post) {
  // 先更新界面，失败再恢复。
  replacePost({ ...post, liked: !post.liked });
  try {
    await api.patch<Post>(`/api/posts/${post.id}`, { liked: !post.liked });
  } catch (failure) {
    replacePost(post);
    toast(failure instanceof Error ? failure.message : "操作失败");
  }
}

export async function addComment(postId: string, body: string) {
  await api.post(`/api/posts/${postId}/comments`, { body });
}

export async function removePost(postId: string) {
  await api.del(`/api/posts/${postId}`);
}

export async function draftCharacter(modelId: string, idea: string) {
  return api.post<CharacterDraft>("/api/characters/drafts", { model_id: modelId, idea });
}

export async function createCharacter(
  data: CharacterDraft & { model_id: string; posting: boolean },
) {
  const character = await api.post<Character>("/api/characters", data);
  set((state) => ({ characters: upsertCharacter(state.characters, character) }));
  return character;
}

export async function updateCharacter(id: string, data: Partial<Character>) {
  const character = await api.patch<Character>(`/api/characters/${id}`, data);
  set((state) => ({ characters: upsertCharacter(state.characters, character) }));
  return character;
}

export async function deleteCharacter(id: string) {
  await api.del(`/api/characters/${id}`);
  forget(id);
}

/** 生成头像或封面，期间在界面上显示进度。 */
export async function paintPortrait(id: string, kind: "avatar" | "cover") {
  set((state) => ({ painting: { ...state.painting, [id]: kind } }));
  try {
    const character = await api.post<Character>(`/api/characters/${id}/portrait`, { kind });
    set((state) => ({ characters: upsertCharacter(state.characters, character) }));
  } catch (failure) {
    toast(failure instanceof Error ? failure.message : "生成失败", 3200);
  } finally {
    set((state) => {
      const painting = { ...state.painting };
      delete painting[id];
      return { painting };
    });
  }
}

function forget(id: string) {
  set((state) => {
    const chats = { ...state.chats };
    delete chats[id];
    return {
      characters: state.characters.filter((item) => item.id !== id),
      chats,
      posts: state.posts.filter((post) => post.character_id !== id),
    };
  });
}

function replacePost(post: Post) {
  set((state) => ({ posts: state.posts.map((item) => (item.id === post.id ? post : item)) }));
}

/** 事件流重连后，已读过的聊天记录可能漏掉了事件，全部作废重新读取。 */
export function resyncCompanion() {
  set({ chats: {} });
  if (get().loaded) {
    void loadCharacters();
  }
  if (get().postsKey) {
    const key = get().postsKey;
    void loadPosts(key === "all" ? null : key);
  }
}

export function receiveCompanion(event: CompanionEvent) {
  switch (event.type) {
    case "character": {
      set((state) => ({ characters: upsertCharacter(state.characters, event.character) }));
      return;
    }
    case "deleted": {
      forget(event.character_id);
      return;
    }
    case "message": {
      const message = event.message;
      set((state) => {
        const next: Partial<CompanionState> = {};
        const chat = state.chats[event.character_id];
        if (chat?.loaded && !chat.messages.some((item) => item.id === message.id)) {
          next.chats = {
            ...state.chats,
            [event.character_id]: { ...chat, messages: [...chat.messages, message] },
          };
        }
        next.characters = state.characters
          .map((character) =>
            character.id === event.character_id
              ? {
                  ...character,
                  last_message: {
                    role: message.role,
                    text: message.image ? "[照片]" : message.body,
                    created_at: message.created_at,
                  },
                }
              : character,
          )
          .sort((a, b) => lastActive(b) - lastActive(a));
        return next;
      });
      return;
    }
    case "typing": {
      set((state) => ({ typing: { ...state.typing, [event.character_id]: event.typing } }));
      return;
    }
    case "posting": {
      set((state) => ({ posting: { ...state.posting, [event.character_id]: event.posting } }));
      return;
    }
    case "post": {
      const post = event.post;
      set((state) => {
        if (state.posts.some((item) => item.id === post.id)) {
          return { posts: state.posts.map((item) => (item.id === post.id ? post : item)) };
        }
        // 新动态只放进正在看的那条流里。
        if (state.postsKey === "all" || state.postsKey === post.character_id) {
          return { posts: [post, ...state.posts] };
        }
        return {};
      });
      return;
    }
    case "post_deleted": {
      set((state) => ({ posts: state.posts.filter((post) => post.id !== event.post_id) }));
      return;
    }
    case "comment": {
      set((state) => ({
        posts: state.posts.map((post) =>
          post.id === event.post_id && !post.comments.some((item) => item.id === event.comment.id)
            ? { ...post, comments: [...post.comments, event.comment] }
            : post,
        ),
      }));
      return;
    }
    case "error": {
      toast(event.error, 3600);
      return;
    }
  }
}
