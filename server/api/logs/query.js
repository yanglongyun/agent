import { fail } from "../http.js";

// 日志接口的查询参数解析。非法参数统一返回 400，不悄悄修正。

/** 非负整数参数；缺省返回 fallback，超出 [min, max] 或不是整数返回 400。 */
export function integerParam(params, name, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const text = params.get(name);
  if (text === null) {
    return fallback;
  }
  const value = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(value) || value < min || value > max) {
    fail(400, `${name} 无效`);
  }
  return value;
}

/** 枚举参数；缺省返回 fallback，不在 allowed 里返回 400。 */
export function choiceParam(params, name, allowed, fallback) {
  const text = params.get(name);
  if (text === null) {
    return fallback;
  }
  if (!allowed.includes(text)) {
    fail(400, `${name} 无效`);
  }
  return text;
}

/** 搜索关键字：去掉首尾空白，最长 200 字符。 */
export function searchParam(params) {
  const text = params.get("q") ?? "";
  if ([...text].length > 200) {
    fail(400, "q 最多 200 字符");
  }
  return text.trim();
}

/** 包含匹配的 LIKE 模式，% _ \ 按字面量转义；SQL 里必须配合 ESCAPE '\'。 */
export function likePattern(text) {
  return `%${text.replace(/[\\%_]/g, "\\$&")}%`;
}
