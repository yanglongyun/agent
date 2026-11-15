// 动态页。/characters 是所有角色的动态流，/characters/:id/moments 是某个角色的主页：
// 顶部是她的封面和头像，下面是她发过的动态。
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { Icon } from "../icons/Icon";
import { Hint } from "../overlay/Hint";
import { toast } from "../overlay/toast";
import { StageHead } from "../shell/heads";
import { Avatar } from "./Avatar";
import { CharacterSheet } from "./CharacterSheet";
import { PostCard } from "./PostCard";
import { loadCharacters, loadPosts, requestPost, useCompanion } from "./store";
import type { Character } from "./types";

function PostingCard({ character }: { character: Character }) {
  return (
    <article className="cp-post cp-post-pending float-in" aria-live="polite">
      <span className="cp-post-avatar">
        <Avatar character={character} size={44} ring />
      </span>
      <div className="cp-post-main">
        <span className="cp-post-name">{character.name}</span>
        <p className="cp-post-body sheen">正在整理照片，准备发一条动态…</p>
        <div className="cp-shimmer" />
      </div>
    </article>
  );
}

function ProfileHero({ character }: { character: Character }) {
  const posting = useCompanion((state) => state.posting[character.id]);
  const painting = useCompanion((state) => state.painting[character.id]);
  const [editing, setEditing] = useState(false);

  async function post() {
    try {
      await requestPost(character.id);
    } catch (failure) {
      toast(failure instanceof Error ? failure.message : "操作失败");
    }
  }

  return (
    <header className="cp-hero">
      <div className="cp-hero-cover">
        {character.cover ? (
          <img src={character.cover} alt="" />
        ) : (
          <div className="cp-hero-placeholder aurora" />
        )}
        {painting === "cover" && (
          <span className="cp-hero-painting">
            <Icon name="loading" size={14} className="spin" />
            正在生成封面…
          </span>
        )}
      </div>
      <div className="cp-hero-body">
        <div className="cp-hero-avatar">
          <Avatar character={character} size={92} ring={Boolean(posting)} />
        </div>
        <div className="cp-hero-text">
          <h2>{character.name}</h2>
          {character.tagline && <p>{character.tagline}</p>}
        </div>
        <div className="cp-hero-actions">
          <Link className="btn btn-accent sm" to={`/characters/${character.id}`}>
            <Icon name="comment" size={14} />
            聊天
          </Link>
          <button
            type="button"
            className="btn btn-quiet sm"
            disabled={Boolean(posting)}
            onClick={() => void post()}
          >
            <Icon
              name={posting ? "loading" : "camera"}
              size={14}
              className={posting ? "spin" : undefined}
            />
            {posting ? "正在发…" : "让她发一条"}
          </button>
          <Hint text="资料">
            <button
              type="button"
              className="icon-btn"
              aria-label="资料"
              onClick={() => setEditing(true)}
            >
              <Icon name="user" size={17} />
            </button>
          </Hint>
        </div>
      </div>
      {editing && <CharacterSheet character={character} onClose={() => setEditing(false)} />}
    </header>
  );
}

function FeedHero({ characters }: { characters: Character[] }) {
  const posting = useCompanion((state) => state.posting);
  return (
    <header className="cp-feed-hero">
      <div className="aurora" />
      <div className="cp-feed-hero-text">
        <h2>动态</h2>
        <p>她们生活里的片段，会在一天里慢慢更新。</p>
      </div>
      {characters.length > 0 && (
        <div className="cp-stories">
          {characters.map((character) => (
            <Link
              key={character.id}
              to={`/characters/${character.id}/moments`}
              className="cp-story"
            >
              <Avatar character={character} size={56} ring={Boolean(posting[character.id])} />
              <span className="clip">{character.name}</span>
            </Link>
          ))}
        </div>
      )}
    </header>
  );
}

export function MomentsView() {
  const { id } = useParams();
  const characterId = id ?? null;
  const characters = useCompanion((state) => state.characters);
  const loaded = useCompanion((state) => state.loaded);
  const posts = useCompanion((state) => state.posts);
  const postsKey = useCompanion((state) => state.postsKey);
  const postsMore = useCompanion((state) => state.postsMore);
  const postsLoading = useCompanion((state) => state.postsLoading);
  const posting = useCompanion((state) => state.posting);
  const [creating, setCreating] = useState(false);
  const key = characterId ?? "all";
  const character = characterId ? characters.find((item) => item.id === characterId) : undefined;
  const byId = new Map(characters.map((item) => [item.id, item]));
  const pending = characters.filter(
    (item) => posting[item.id] && (characterId === null || item.id === characterId),
  );

  useEffect(() => {
    if (!loaded) {
      void loadCharacters();
    }
  }, [loaded]);

  useEffect(() => {
    void loadPosts(characterId);
  }, [characterId]);

  const ready = postsKey === key;
  let title = "动态";
  if (character) {
    title = `${character.name} 的动态`;
  }

  return (
    <section className="stage cp-moments">
      <StageHead title={title} />
      <main className="stage-scroll">
        <div className="cp-moments-inner">
          {characterId && character && <ProfileHero character={character} />}
          {characterId && loaded && !character && (
            <p className="note cp-pad">这个角色不存在或已被删除。</p>
          )}
          {!characterId && <FeedHero characters={characters} />}

          {!characterId && loaded && characters.length === 0 && (
            <div className="cp-welcome float-in">
              <Icon name="heart" size={26} />
              <h3>创建你的第一个角色</h3>
              <p>她有自己的性格和生活：会和你聊天、记得你说过的话，也会在这里分享日常和照片。</p>
              <button type="button" className="btn btn-accent" onClick={() => setCreating(true)}>
                <Icon name="plus" size={16} />
                创建角色
              </button>
            </div>
          )}

          <div className="cp-timeline">
            {pending.map((item) => (
              <PostingCard key={item.id} character={item} />
            ))}
            {ready &&
              posts.map((post) => {
                const owner = byId.get(post.character_id);
                if (!owner) {
                  return null;
                }
                return <PostCard key={post.id} post={post} character={owner} />;
              })}
            {ready && posts.length === 0 && pending.length === 0 && characters.length > 0 && (
              <p className="cp-quiet">
                {character
                  ? `${character.name} 还没有发过动态。`
                  : "还没有动态，过一会儿再来看看。"}
              </p>
            )}
            {(!ready || postsLoading) && <p className="cp-quiet">正在读取…</p>}
            {ready && postsMore && !postsLoading && (
              <button
                type="button"
                className="btn btn-quiet sm cp-more"
                onClick={() => void loadPosts(characterId, true)}
              >
                更早的动态
              </button>
            )}
          </div>
        </div>
      </main>
      {creating && <CharacterSheet onClose={() => setCreating(false)} />}
    </section>
  );
}
