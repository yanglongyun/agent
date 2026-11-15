// 一条动态：头像、名字、正文、照片，下面是时间地点、点赞评论，以及评论区。
import { useState, type KeyboardEvent } from "react";
import { Link } from "react-router";
import { Icon } from "../icons/Icon";
import { toast } from "../overlay/toast";
import { Avatar } from "./Avatar";
import { momentTime } from "./format";
import { viewImage } from "./Lightbox";
import { addComment, removePost, toggleLike } from "./store";
import type { Character, Post } from "./types";

export function PostCard({ post, character }: { post: Post; character: Character }) {
  const [commenting, setCommenting] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const waiting =
    post.comments.length > 0 && post.comments[post.comments.length - 1].author === "user";

  async function submit() {
    const body = text.trim();
    if (!body || sending) {
      return;
    }
    setSending(true);
    try {
      await addComment(post.id, body);
      setText("");
      setCommenting(false);
    } catch (failure) {
      toast(failure instanceof Error ? failure.message : "评论失败");
    } finally {
      setSending(false);
    }
  }

  function keydown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
    if (event.key === "Escape") {
      setCommenting(false);
    }
  }

  async function remove() {
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 3000);
      return;
    }
    try {
      await removePost(post.id);
    } catch (failure) {
      toast(failure instanceof Error ? failure.message : "删除失败");
    }
  }

  return (
    <article className="cp-post float-in">
      <Link to={`/characters/${character.id}/moments`} className="cp-post-avatar">
        <Avatar character={character} size={44} />
      </Link>
      <div className="cp-post-main">
        <Link to={`/characters/${character.id}/moments`} className="cp-post-name">
          {character.name}
        </Link>
        <p className="cp-post-body">{post.body}</p>
        {post.images.map((src) => (
          <button
            key={src}
            type="button"
            className="cp-post-photo"
            aria-label="查看照片"
            onClick={() => viewImage(src, post.body)}
          >
            <img src={src} alt="" loading="lazy" />
          </button>
        ))}
        <div className="cp-post-meta">
          <span>{momentTime(post.created_at)}</span>
          {post.location && (
            <span className="cp-post-place">
              <Icon name="pin2" size={12} />
              {post.location}
            </span>
          )}
          {post.mood && <span className="cp-post-mood">{post.mood}</span>}
          <span className="grow" />
          <button
            type="button"
            className={`cp-post-action danger${confirming ? " confirm" : ""}`}
            aria-label="删除动态"
            onClick={() => void remove()}
          >
            {confirming ? "确认删除" : <Icon name="trash" size={15} />}
          </button>
          <button
            type="button"
            className={`cp-post-action like${post.liked ? " on" : ""}`}
            aria-label={post.liked ? "取消点赞" : "点赞"}
            aria-pressed={post.liked}
            onClick={() => void toggleLike(post)}
          >
            <Icon name="heart" size={16} />
          </button>
          <button
            type="button"
            className="cp-post-action"
            aria-label="评论"
            onClick={() => setCommenting((value) => !value)}
          >
            <Icon name="comment" size={16} />
          </button>
        </div>
        {(post.liked || post.comments.length > 0 || commenting) && (
          <div className="cp-post-social">
            {post.liked && (
              <div className="cp-post-likes">
                <Icon name="heart" size={13} />
                <span>我</span>
              </div>
            )}
            {post.comments.map((comment) => (
              <p key={comment.id} className="cp-comment">
                <b>{comment.author === "user" ? "我" : character.name}</b>
                {comment.author === "character" && post.comments.length > 1 && (
                  <span className="cp-comment-reply"> 回复 </span>
                )}
                {comment.author === "character" && post.comments.length > 1 && <b>我</b>}
                <span>：{comment.body}</span>
              </p>
            ))}
            {waiting && <p className="cp-comment-wait sheen">{character.name} 看到了你的评论…</p>}
            {commenting && (
              <div className="cp-comment-box">
                <input
                  autoFocus
                  value={text}
                  maxLength={1000}
                  placeholder={`评论 ${character.name} 的动态`}
                  aria-label="评论"
                  onChange={(event) => setText(event.target.value)}
                  onKeyDown={keydown}
                />
                <button
                  type="button"
                  className="btn btn-accent sm"
                  disabled={!text.trim() || sending}
                  onClick={() => void submit()}
                >
                  发送
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
