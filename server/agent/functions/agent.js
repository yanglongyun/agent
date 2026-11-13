export default async function agent(args, config, signal, context, callId) {
  if (!context) {
    throw new Error("当前运行没有任务执行器");
  }
  let result;
  switch (args.action) {
    case "models":
      return {
        text: JSON.stringify(
          config.models.map(({ id, name, model, protocol }) => ({ id, name, model, protocol })),
        ),
      };
    case "start":
      result = context.manager.start(args, context, config, callId);
      break;
    case "status":
      result = context.manager.info(args.task_id, context);
      break;
    case "wait":
      result = await context.manager.wait(args.task_id, context, signal, args.seconds ?? 30);
      break;
    case "cancel":
      result = await context.manager.cancel(args.task_id, context);
      break;
    default:
      throw new Error("action 必须是 models、start、status、wait 或 cancel");
  }
  const terminal = ["completed", "failed", "cancelled", "interrupted"].includes(result.status);
  let response = result;
  if (result.id) {
    response = {
      task_id: result.id,
      status: result.status,
      model: result.model,
      result: result.result,
      error: result.error,
      cost: result.cost,
    };
  }
  return { text: JSON.stringify(response), taskResults: terminal ? [result.id] : [] };
}
