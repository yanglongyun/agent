import login from "./login/index.js";
import logout from "./logout/index.js";
import me from "./me/index.js";
import { fail } from "../http.js";

export default async function auth(req, res, parts, context) {
  const name = parts[0];
  const rest = parts.slice(1);
  switch (name) {
    case "login":
      return login(req, res, rest, context);
    case "logout":
      return logout(req, res, rest, context);
    case "me":
      return me(req, res, rest, context);
    default:
      fail(404, "接口不存在");
  }
}
