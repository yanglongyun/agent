import { modelView } from "../../config.js";
import { json } from "../http.js";

export default async function status(req, res, context) {
  const config = context.config;
  return json(res, 200, {
    version: context.version,
    models: config.models.map(modelView),
    workdir: config.workdir || process.cwd(),
    data_dir: context.paths.root,
  });
}
