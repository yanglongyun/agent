import type { CSSProperties } from "react";

// 品牌标志：与 index.html 的 favicon 同一枚终端图标。
export function Mark({ size = 32, style }: { size?: number; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" style={style} aria-hidden="true">
      <defs>
        <linearGradient id="agent-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4c82ff" />
          <stop offset="0.55" stopColor="#6a5cf6" />
          <stop offset="1" stopColor="#a35cf2" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="28" height="28" rx="8.5" fill="url(#agent-mark)" />
      <path
        d="m11 11 5.4 5-5.4 5M18.6 21.4h4"
        fill="none"
        stroke="#fff"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
