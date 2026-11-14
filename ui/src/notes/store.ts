import { create } from "zustand";
import { api } from "../lib/api";
import { notePreview } from "./format";
import type { Note, NoteSummary } from "./types";

interface NotesState {
  notes: NoteSummary[];
  loading: boolean;
  loaded: boolean;
  error: string;
  load: () => Promise<void>;
  create: () => Promise<Note>;
  remove: (id: string) => Promise<void>;
  /** 保存成功后更新列表里的标题、预览和顺序。 */
  touch: (note: Note) => void;
}

function summary(note: Note): NoteSummary {
  return {
    id: note.id,
    title: note.title,
    preview: notePreview(note.body),
    created_at: note.created_at,
    updated_at: note.updated_at,
  };
}

export const useNotes = create<NotesState>((set) => ({
  notes: [],
  loading: false,
  loaded: false,
  error: "",
  async load() {
    set({ loading: true });
    try {
      const data = await api.get<{ notes: NoteSummary[] }>("/api/notes");
      set({ notes: data.notes, loading: false, loaded: true, error: "" });
    } catch (failure) {
      set({
        loading: false,
        loaded: true,
        error: failure instanceof Error ? failure.message : "读取失败",
      });
    }
  },
  async create() {
    const note = await api.post<Note>("/api/notes", { title: "", body: "" });
    set((state) => ({ notes: [summary(note), ...state.notes] }));
    return note;
  },
  async remove(id) {
    await api.del(`/api/notes/${id}`);
    set((state) => ({ notes: state.notes.filter((note) => note.id !== id) }));
  },
  touch(note) {
    set((state) => ({
      notes: [summary(note), ...state.notes.filter((item) => item.id !== note.id)],
    }));
  },
}));
