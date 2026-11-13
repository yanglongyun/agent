// 对话列:顶栏 + 消息流 + 输入区。
import { useEffect } from "react";
import { Link, useParams } from "react-router";
import { Hint } from "../overlay/Hint";
import { Icon, Mark } from "../icons/Icon";
import { useShell } from "../shell/layout";
import { Composer } from "./Composer";
import { MessageStream } from "./MessageStream";
import { ModelSelect } from "./ModelSelect";
import { createDraft, openThread, threadTitle, useThread } from "./store";

// 标题下的副标题只显示一种状态：断线 > 正在回复 > 没有模型 > 模型选择。
function TopbarStatus() {
  const { busy, connected, status } = useThread();
  if (!connected) {
    return (
      <span className="topbar-sub is-warn" role="status">
        <span className="status-dot is-warn" />
        正在重新连接…
      </span>
    );
  }
  if (busy) {
    return (
      <span className="topbar-sub" role="status">
        <span className="typing" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        正在回复…
      </span>
    );
  }
  if (status && status.models.length === 0) {
    return (
      <Link to="/settings" className="topbar-sub is-warn">
        请先添加模型
      </Link>
    );
  }
  return <ModelSelect />;
}

export function ThreadView() {
  const shell = useShell();
  const { id } = useParams();
  useEffect(() => {
    if (id) {
      void openThread(id);
    } else {
      createDraft();
    }
  }, [id]);
  const { threads, currentId, messages, ready, loadError } = useThread();
  const title = currentId
    ? threadTitle(threads.find((item) => item.id === currentId)) || "对话"
    : "新对话";

  return (
    <section className={`thread${ready && !messages.length ? " is-blank" : ""}`}>
      <header className="topbar">
        <button
          className={`icon-btn menu-btn${shell.collapsed ? " show" : ""}`}
          aria-label="展开侧栏"
          onClick={shell.openSidebar}
        >
          <Icon name="panel" size={17} />
        </button>
        <Mark size={38} />
        <div className="topbar-main">
          <span className="topbar-title clip">{title}</span>
          <TopbarStatus />
        </div>
        <div className="topbar-actions">
          {currentId && (
            <Hint text="新对话">
              <Link to="/" className="icon-btn" aria-label="新对话">
                <Icon name="compose" size={18} />
              </Link>
            </Hint>
          )}
        </div>
      </header>
      {loadError ? (
        <main className="route-error">
          <Icon name="alert" size={28} />
          <h2>暂时无法打开对话</h2>
          <p>{loadError}</p>
          <button className="btn" onClick={() => id && void openThread(id, true)}>
            重试
          </button>
          <Link to="/">返回新对话</Link>
        </main>
      ) : (
        <>
          <MessageStream />
          <Composer />
        </>
      )}
    </section>
  );
}
