import type { Attachment } from "./thread";

type Draft = { text: string; attachments: Attachment[] };
const drafts = new Map<string, Draft>();
export const getDraft = (id: string): Draft => drafts.get(id) || { text: "", attachments: [] };
export const saveDraft = (id: string, draft: Draft) => drafts.set(id, draft);
window.addEventListener("signed-out", () => drafts.clear());
