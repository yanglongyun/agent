import type { Character } from "./types";

// 头像：有照片显示照片，没有时用名字首字配柔和的渐变。
export function Avatar({
  character,
  size = 40,
  ring = false,
}: {
  character: Pick<Character, "name" | "avatar">;
  size?: number;
  ring?: boolean;
}) {
  const initial = [...character.name.trim()][0] ?? "?";
  return (
    <span
      className={`cp-avatar${ring ? " ring" : ""}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      aria-hidden="true"
    >
      {character.avatar ? <img src={character.avatar} alt="" draggable={false} /> : initial}
    </span>
  );
}
