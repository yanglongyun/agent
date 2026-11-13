import { json } from "../http.js";

export default async function get(req, res, context) {
  const config = context.config;
  const view = {
    models: config.models.map(({ key, ...model }) => ({ ...model, key_set: Boolean(key) })),
    system: config.system,
    compact_at: config.compact_at,
    compact_on_cache_expiry: config.compact_on_cache_expiry,
    cache_ttl: config.cache_ttl,
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
