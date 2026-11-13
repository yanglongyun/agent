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
