// 渲染崩了之后还剩下什么。
//
// React 的默认行为是**把整棵树卸掉** —— 一个组件抛异常,用户看到的是纯白。
// 白屏最坏的地方不是丢了功能,是它什么都不说:用户不知道是没网、还没加载完,
// 还是坏了,于是只能反复重启,而重启多半修不好(状态还在库里,下次渲染照样炸)。
//
// 这里不追求「优雅降级」—— 崩了就是崩了。它要做的只有三件:
// 说出来、给一条回去的路、把错误留下来。
import { Component, type ReactNode } from "react";

import { t } from "@/i18n";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class Boundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // 记录错误与组件栈供排查。
    console.error("[render]", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }
    return (
      <div className="crash">
        <div className="crash-box">
          <h1>{t("crash.title")}</h1>
          <p>{t("crash.body")}</p>
          {/* 原文照登,不翻译也不美化 —— 用户把它截图发过来时,
                        我们要的是那一行原话,而不是「发生了一个错误」 */}
          <code className="crash-detail">{error.message || String(error)}</code>
          <div className="crash-ops">
            {/* 「回到首页」在前:大多数崩溃是某一页的事,换一页就好了,
                            而重新载入要重连、重拉,慢得多 */}
            <button
              className="crash-op"
              onClick={() => {
                location.href = "/conversation";
              }}
            >
              {t("crash.home")}
            </button>
            <button className="crash-op primary" onClick={() => location.reload()}>
              {t("crash.reload")}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
