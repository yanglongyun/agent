export const labels: Record<string, string> = {
  running: "执行中",
  cancelling: "正在停止",
  completed: "已完成",
  failed: "执行失败",
  cancelled: "已停止",
  interrupted: "已中断",
};
export function active(record: { status: string }) {
  return record.status === "running" || record.status === "cancelling";
}

/** 状态徽章的色调：进行中绿色带呼吸点，失败红色，其余中性。配合 .badge 使用。 */
export function statusTone(status: string) {
  if (status === "running" || status === "cancelling") {
    return "is-ok is-live";
  }
  if (status === "failed" || status === "interrupted") {
    return "is-danger";
  }
  return "";
}
