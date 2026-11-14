// 置顶组的顺序运算：拖拽松手后，把「拖了谁、落在哪」换算成服务端要的完整置顶列表。
export type DropTarget = { kind: "pinned"; index: number } | { kind: "recent" };

/**
 * pinnedIds 是当前置顶组从上到下的会话 ID。
 * 落在置顶组：index 按「不含被拖会话」的行计算，插入到该下标；
 * 落在其余会话区域：从置顶组移除（取消置顶）。
 */
export function nextPinnedIds(pinnedIds: string[], dragId: string, target: DropTarget): string[] {
  const rest = pinnedIds.filter((id) => id !== dragId);
  if (target.kind === "recent") {
    return rest;
  }
  const index = Math.max(0, Math.min(target.index, rest.length));
  return [...rest.slice(0, index), dragId, ...rest.slice(index)];
}

export function samePinnedIds(a: string[], b: string[]) {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}
