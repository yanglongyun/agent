import { json } from "../http.js";

export default async function get(req, res, context) {
  const config = context.config;
  let keyHint = "";
  if (config.key) {
    if (config.key.length <= 10) {
      keyHint = "***";
    } else {
      keyHint = config.key.slice(0, 6) + "..." + config.key.slice(-4);
    }
  }

  const view = {
    url: config.url,
    key_set: Boolean(config.key),
    key_hint: keyHint,
    model: config.model,
    protocol: config.protocol,
    context_window: config.context_window,
    system: config.system,
    compact_at: config.compact_at,
    keep: config.keep,
    compact_system: config.compact_system,
    compact_prefix: config.compact_prefix,
    workdir: config.workdir,
    run_timeout: config.run_timeout,
    timeout: config.timeout,
    max_output: config.max_output,
    api: { listen: config.api.listen },
    paths: {
      data_dir: context.paths.root,
      config: context.paths.config,
      web_dir: context.publicDir,
    },
  };
  return json(res, 200, view);
}
