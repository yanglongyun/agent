export default async function stdio(args, config, signal, context) {
  if (!context) {
    throw new Error("当前运行没有命令执行器");
  }
  const record = await context.manager.shell.stdio(args, context, signal);
  return {
    failed: ["failed", "interrupted"].includes(record.status),
    text: JSON.stringify({
      process_id: record.id,
      status: record.status,
      output: record.output,
      truncated: Boolean(record.truncated),
      stdin_closed: Boolean(record.stdin_closed),
      exit_code: record.exit_code,
      error: record.error,
    }),
  };
}
