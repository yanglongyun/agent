import { json } from "../http.js";

export default async function status(req, res, context) {
  const config = context.config;
  return json(res, 200, {
    version: context.version,
    model: config.model,
    protocol: config.protocol,
    url: config.url,
    model_ready: Boolean(config.url && config.key && config.model),
    workdir: config.workdir || process.cwd(),
    data_dir: context.paths.root,
  });
}
