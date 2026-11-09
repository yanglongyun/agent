import { toast } from "../overlay/toast";

export async function copyText(content = "") {
  try {
    if (!navigator.clipboard) {
      throw new Error("当前页面无法访问剪贴板，请使用 HTTPS 或手动复制");
    }
    await navigator.clipboard.writeText(content);
    toast("已复制");
    return true;
  } catch (error) {
    toast(error instanceof Error ? error.message : "复制失败");
    return false;
  }
}
