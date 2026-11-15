export interface Character {
  id: string;
  name: string;
  tagline: string;
  persona: string;
  appearance: string;
  memory: string;
  avatar: string | null;
  cover: string | null;
  model_id: string;
  posting: boolean;
  last_message: { role: "user" | "character"; text: string; created_at: number } | null;
  typing: boolean;
  posting_now: boolean;
  created_at: number;
  updated_at: number;
  next_post_at: number | null;
}

export interface ChatMessage {
  id: number;
  character_id: string;
  role: "user" | "character";
  body: string;
  image: string | null;
  post_id: string | null;
  created_at: number;
}

export interface Comment {
  id: number;
  post_id: string;
  author: "user" | "character";
  body: string;
  created_at: number;
}

export interface Post {
  id: string;
  character_id: string;
  body: string;
  images: string[];
  mood: string | null;
  location: string | null;
  liked: boolean;
  comments: Comment[];
  created_at: number;
}

export interface CharacterDraft {
  name: string;
  tagline: string;
  persona: string;
  appearance: string;
}

/** 全局事件流里 { companion } 帧的内容。 */
export type CompanionEvent =
  | { type: "character"; character: Character }
  | { type: "deleted"; character_id: string }
  | { type: "message"; character_id: string; message: ChatMessage }
  | { type: "typing"; character_id: string; typing: boolean | "photo" }
  | { type: "posting"; character_id: string; posting: boolean }
  | { type: "post"; post: Post }
  | { type: "post_deleted"; post_id: string }
  | { type: "comment"; post_id: string; comment: Comment }
  | { type: "error"; character_id: string; error: string };
