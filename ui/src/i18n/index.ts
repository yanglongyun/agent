// 界面语言属于当前浏览器偏好。
import { create } from "zustand";

import { en } from "./en";
import { zh } from "./zh";

export type Lang = "zh" | "en";
export type Key = keyof typeof zh;

/**
 * **`Record<Key, string>` 而不是 `Record<string, string>`** —— 这一个字的差别,
 * 决定了「英文少一条」是编译期报错还是运行期悄悄显示中文。
 *
 * 从前是后者:zh.ts 顶上写着「key 必须一模一样」,但没有任何东西在管这件事,
 * 而漏一条在界面上看起来只是「这里忘了翻译」,没人会去查。
 */
const TABLES: Record<Lang, Record<Key, string>> = { zh, en };

/** 系统偏好。`zh`、`zh-CN`、`zh-Hans` 都算中文,其余一律英文。 */
const guessLang = (): Lang =>
  (navigator.languages || [navigator.language || ""]).some((tag) => /^zh\b/i.test(tag))
    ? "zh"
    : "en";

type State = { lang: Lang };

export const useLang = create<State>(() => ({ lang: guessLang() }));

/**
 * 取一条文案。
 *
 * 缺词时**回退到中文再回退到 key 本身**,不返回空串 —— 空按钮是最难查的一种坏:
 * 它看起来只是「样式没写好」。缺了就在界面上显示成 key,一眼能看见。
 */
export function t(key: Key, vars?: Record<string, string | number>): string {
  const table = TABLES[useLang.getState().lang] || zh;
  let text = table[key] ?? zh[key] ?? String(key);
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.split(`{${name}}`).join(String(value));
    }
  }
  return text;
}

/** 组件里用它,这样切语言会重渲染 —— 直接调 t() 的地方不会。 */
export const useT = () => {
  useLang((state) => state.lang);
  return t;
};

export const setLang = (lang: Lang) => useLang.setState({ lang });
