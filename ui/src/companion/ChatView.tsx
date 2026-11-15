// 和角色聊天：她的气泡在左侧带头像，你的在右侧；背景是她主页封面的柔光。
// 发送后立即显示自己的消息，她的回复通过事件流一条条推送，期间显示「正在输入」。
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link, useParams } from "react-router";
import { Icon } from "../icons/Icon";
import { Hint } from "../overlay/Hint";
import { toast } from "../overlay/toast";
import { StageHead } from "../shell/heads";
import { Avatar } from "./Avatar";
import { CharacterSheet } from "./CharacterSheet";
import { chatDivider } from "./format";
import { viewImage } from "./Lightbox";
import { loadCharacters, loadOlderMessages, openChat, sendMessage, useCompanion } from "./store";
import type { Character, ChatMessage } from "./types";

const starters = ["在干嘛呀", "今天过得怎么样？", "给我拍张照片看看", "推荐一首最近在听的歌"];

function Bubble({
  message,
  character,
  showAvatar,
}: {
  message: ChatMessage;
  character: Character;
  showAvatar: boolean;
}) {
  const mine = message.role === "user";
  return (
    <div className={`cp-msg ${mine ? "mine" : "hers"}`}>
      {!mine && (
        <span className="cp-msg-avatar">
          {showAvatar && <Avatar character={character} size={34} />}
        </span>
      )}
      {message.image ? (
        <button
          type="button"
          className="cp-photo"
          aria-label={`查看照片：${message.body}`}
          onClick={() => viewImage(message.image!, message.body)}
        >
          <img src={message.image} alt={message.body} loading="lazy" />
        </button>
      ) : (
        <div className="cp-bubble-group">
          <div className="cp-bubble">{message.body}</div>
          {message.post_id && (
            <Link className="cp-share" to={`/characters/${character.id}/moments`}>
              <Icon name="moments" size={14} />
              <span>看看她刚发的动态</span>
              <Icon name="chev" size={14} />
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

export function ChatView() {
  const { id = "" } = useParams();
  const character = useCompanion((state) => state.characters.find((item) => item.id === id));
  const loaded = useCompanion((state) => state.loaded);
  const chat = useCompanion((state) => state.chats[id]);
  const typing = useCompanion((state) => state.typing[id]);
  const posting = useCompanion((state) => state.posting[id]);
  const painting = useCompanion((state) => state.painting[id]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  const olderAnchor = useRef<number | null>(null);

  useEffect(() => {
    if (!loaded) {
      void loadCharacters();
    }
  }, [loaded]);

  useEffect(() => {
    if (!id) {
      return;
    }
    setLoadError("");
    stick.current = true;
    openChat(id).catch((failure) =>
      setLoadError(failure instanceof Error ? failure.message : "读取失败"),
    );
  }, [id]);

  useEffect(() => {
    input.current?.focus();
  }, [id]);

  // 新消息到达时，如果本来就停在底部就跟着滚到底；向上翻看历史时不打扰。
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) {
      return;
    }
    if (olderAnchor.current !== null) {
      element.scrollTop = element.scrollHeight - olderAnchor.current;
      olderAnchor.current = null;
      return;
    }
    if (stick.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [chat?.messages.length, typing]);

  function trackScroll() {
    const element = scroller.current;
    if (element) {
      stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    }
  }

  async function older() {
    const element = scroller.current;
    if (element) {
      olderAnchor.current = element.scrollHeight - element.scrollTop;
    }
    await loadOlderMessages(id).catch(() => {
      olderAnchor.current = null;
    });
  }

  async function send(text: string) {
    const body = text.trim();
    if (!body || sending) {
      return;
    }
    setSending(true);
    stick.current = true;
    try {
      await sendMessage(id, body);
      setDraft("");
    } catch (failure) {
      toast(failure instanceof Error ? failure.message : "发送失败");
    } finally {
      setSending(false);
      input.current?.focus();
    }
  }

  function keydown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send(draft);
    }
  }

  if (!character) {
    return (
      <section className="stage">
        <StageHead title="角色" />
        <div className="cp-blank">
          {loaded ? (
            <p className="note">这个角色不存在或已被删除。</p>
          ) : (
            <p className="note">正在读取…</p>
          )}
        </div>
      </section>
    );
  }

  let status = character.tagline;
  if (typing === "photo") {
    status = "正在拍照…";
  } else if (typing) {
    status = "正在输入…";
  } else if (posting) {
    status = "正在发动态…";
  }
  const messages = chat?.messages ?? [];
  const backdrop = character.cover ?? character.avatar;

  return (
    <section className="stage cp-chat">
      {backdrop && (
        <div className="cp-ambient" aria-hidden="true">
          <img src={backdrop} alt="" />
        </div>
      )}
      <StageHead
        title={character.name}
        leading={
          <button
            type="button"
            className="cp-head-avatar"
            aria-label="查看资料"
            onClick={() => setEditing(true)}
          >
            <Avatar character={character} size={30} ring={Boolean(posting)} />
          </button>
        }
        meta={<span className={`cp-status clip${typing || posting ? " live" : ""}`}>{status}</span>}
      >
        <Hint text="她的动态">
          <Link
            className="icon-btn"
            to={`/characters/${character.id}/moments`}
            aria-label="她的动态"
          >
            <Icon name="moments" size={18} />
          </Link>
        </Hint>
        <Hint text="资料">
          <button
            type="button"
            className="icon-btn"
            aria-label="资料"
            onClick={() => setEditing(true)}
          >
            <Icon name="user" size={18} />
          </button>
        </Hint>
      </StageHead>

      <div className="cp-chat-scroll" ref={scroller} onScroll={trackScroll}>
        <div className="cp-chat-inner">
          {loadError && <p className="note is-error">{loadError}</p>}
          {chat?.hasMore && (
            <button type="button" className="cp-older" onClick={() => void older()}>
              查看更早的消息
            </button>
          )}
          {chat?.loaded && messages.length === 0 && (
            <div className="cp-hello float-in">
              <div className="cp-hello-avatar">
                <Avatar character={character} size={96} />
                {painting === "avatar" && (
                  <span className="cp-hello-painting">
                    <Icon name="loading" size={18} className="spin" />
                  </span>
                )}
              </div>
              <h2>{character.name}</h2>
              {character.tagline && <p>{character.tagline}</p>}
              {painting && <span className="cp-hello-note sheen">正在为她拍摄形象照…</span>}
              <div className="cp-starters">
                {starters.map((text) => (
                  <button key={text} type="button" onClick={() => void send(text)}>
                    {text}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((message, index) => {
            const previous = messages[index - 1];
            const divider = chatDivider(message.created_at, previous?.created_at ?? null);
            const showAvatar =
              message.role === "character" &&
              (!previous || previous.role !== "character" || divider !== null);
            return (
              <div key={message.id} className="cp-line">
                {divider && <div className="cp-divider">{divider}</div>}
                <Bubble message={message} character={character} showAvatar={showAvatar} />
              </div>
            );
          })}
          {typing && (
            <div className="cp-msg hers cp-typing-row">
              <span className="cp-msg-avatar">
                <Avatar character={character} size={34} />
              </span>
              {typing === "photo" ? (
                <div className="cp-bubble cp-shooting">
                  <Icon name="camera" size={15} />
                  <span className="sheen">正在拍照</span>
                </div>
              ) : (
                <div className="cp-bubble cp-typing" aria-label="正在输入">
                  <i />
                  <i />
                  <i />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <footer className="cp-composer">
        <div className="cp-composer-box">
          <textarea
            ref={input}
            rows={1}
            value={draft}
            placeholder={`和${character.name}说点什么…`}
            aria-label="消息"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={keydown}
          />
          <button
            type="button"
            className="cp-send"
            aria-label="发送"
            disabled={!draft.trim() || sending}
            onClick={() => void send(draft)}
          >
            <Icon name="send" size={17} />
          </button>
        </div>
      </footer>
      {editing && <CharacterSheet character={character} onClose={() => setEditing(false)} />}
    </section>
  );
}
