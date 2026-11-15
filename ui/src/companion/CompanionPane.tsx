import { useEffect, useState } from "react";
import { Link, useMatch } from "react-router";
import { Icon } from "../icons/Icon";
import { Hint } from "../overlay/Hint";
import { PaneHead } from "../shell/heads";
import { useShell } from "../shell/layout";
import { Avatar } from "./Avatar";
import { CharacterSheet } from "./CharacterSheet";
import { shortTime } from "./format";
import { loadCharacters, useCompanion } from "./store";

// 角色应用的列表栏：最上面是所有人的动态，下面是按最近聊天排序的角色。
export function CompanionPane() {
  const chat = useMatch("/characters/:id");
  const moments = useMatch("/characters/:id/moments");
  const feed = useMatch("/characters");
  const selectedId = chat?.params.id ?? moments?.params.id;
  const closeDrawer = useShell((state) => state.closeDrawer);
  const { characters, loaded, error, typing, posting } = useCompanion();
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void loadCharacters();
  }, []);

  return (
    <>
      <PaneHead title="角色" />
      <div className="pane-tools">
        <Link
          to="/characters"
          className={`row cp-feed-row grow${feed ? " on" : ""}`}
          onClick={closeDrawer}
        >
          <span className="cp-feed-icon">
            <Icon name="moments" size={17} />
          </span>
          <span className="clip">动态</span>
        </Link>
        <Hint text="创建角色">
          <button
            type="button"
            className="compose-btn"
            aria-label="创建角色"
            onClick={() => setCreating(true)}
          >
            <Icon name="plus" size={18} />
          </button>
        </Hint>
      </div>
      <nav className="pane-scroll" aria-label="角色列表">
        {error && <p className="note is-error">{error}</p>}
        {!loaded && <p className="note">正在读取…</p>}
        {loaded && !error && characters.length === 0 && (
          <div className="empty">
            <Icon name="heart" size={22} />
            <span>还没有角色</span>
          </div>
        )}
        {characters.map((character) => {
          let preview = character.last_message?.text ?? character.tagline;
          let live = false;
          if (typing[character.id] === "photo") {
            preview = "正在拍照…";
            live = true;
          } else if (typing[character.id]) {
            preview = "正在输入…";
            live = true;
          } else if (posting[character.id]) {
            preview = "正在发动态…";
            live = true;
          }
          return (
            <Link
              key={character.id}
              to={`/characters/${character.id}`}
              className={`row cp-row${selectedId === character.id ? " on" : ""}`}
              onClick={closeDrawer}
            >
              <Avatar character={character} size={40} ring={Boolean(posting[character.id])} />
              <span className="cp-row-main">
                <span className="cp-row-top">
                  <span className="cp-row-name clip">{character.name}</span>
                  {character.last_message && (
                    <span className="cp-row-time">
                      {shortTime(character.last_message.created_at)}
                    </span>
                  )}
                </span>
                <span className={`cp-row-preview clip${live ? " live" : ""}`}>
                  {preview || "打个招呼吧"}
                </span>
              </span>
            </Link>
          );
        })}
      </nav>
      {creating && <CharacterSheet onClose={() => setCreating(false)} />}
    </>
  );
}
