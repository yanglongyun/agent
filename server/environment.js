import os from "node:os";

// 用户消息创建时捕获，之后只读取保存的快照。
export function captureEnvironment(workdir, time) {
  return {
    os: process.platform === "win32" ? "windows" : process.platform,
    arch: process.arch === "x64" ? "amd64" : process.arch,
    host: os.hostname(),
    user: os.userInfo().username,
    workdir: workdir || process.cwd(),
    time: new Date(time).toISOString(),
  };
}

// 仅用于本次模型上下文，不修改数据库正文和交付界面的 item。
export function appendEnvironment(item, environment) {
  item.content.push({
    type: "input_text",
    text: `\n\n环境：${environment.os}/${environment.arch}，主机 ${environment.host}，用户 ${environment.user}，工作目录 ${environment.workdir}，时间 ${environment.time}。`,
  });
}
