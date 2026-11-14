const pad = (value: number) => String(value).padStart(2, "0");

/** 没有标题的笔记在列表和标题行里统一显示为「未命名笔记」。 */
export function noteTitle(note: { title: string }) {
  return note.title.trim() || "未命名笔记";
}

/** 列表预览：把换行和连续空白压成空格，去掉首尾空白。 */
export function notePreview(body: string, limit = 80) {
  return body.replace(/\s+/g, " ").trim().slice(0, limit);
}

/** 今天显示时分，其他日期显示月日。 */
export function noteTime(at: number, now = Date.now()) {
  const date = new Date(at);
  const today = new Date(now);
  if (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  ) {
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}
