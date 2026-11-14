// 对话舞台:标题行 + 消息流 + 输入区。空白对话时输入区居中,下面是起手式。
import { useEffect } from "react";
import { Link, useParams } from "react-router";
import { Icon } from "../icons/Icon";
import { StageHead } from "../shell/heads";
import { Composer } from "./Composer";
import { MessageStream } from "./MessageStream";
import { Starters } from "./Starters";
import { ThreadMenu } from "./ThreadMenu";
import { createDraft, openThread, threadTitle, useThread } from "./store";

export function ThreadView() {
  const { id } = useParams();
  useEffect(() => {
    if (id) {
      void openThread(id);
    } else {
      createDraft();
    }
  }, [id]);
  const { threads, currentId, messages, notes, ready, loadError } = useThread();
  const title = currentId
    ? threadTitle(threads.find((item) => item.id === currentId)) || "对话"
    : "新对话";
  const blank = ready && messages.length === 0 && notes.length === 0 && !loadError;

  return (
    <section className={`stage thread${blank ? " is-blank" : ""}`}>
      <StageHead title={title}>
        <ThreadMenu />
      </StageHead>
      {loadError ? (
        <main className="route-error">
          <Icon name="alert" size={28} />
          <h2>暂时无法打开对话</h2>
          <p>{loadError}</p>
          <div className="route-error-actions">
            <button className="btn btn-accent" onClick={() => id && void openThread(id, true)}>
              重试
            </button>
            <Link className="btn btn-quiet" to="/">
              返回新对话
            </Link>
          </div>
        </main>
      ) : (
        <>
          {blank && <div className="aurora" aria-hidden="true" />}
          <MessageStream />
          <Composer />
          {blank && <Starters />}
        </>
      )}
    </section>
  );
}
