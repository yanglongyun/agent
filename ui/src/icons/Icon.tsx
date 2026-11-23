import type { CSSProperties } from "react";
import { ICONS } from "./assets";

export function Icon({
  name,
  size = 18,
  style,
  className,
}: {
  name: string;
  size?: number;
  style?: CSSProperties;
  className?: string;
}) {
  const icon = ICONS[name];
  if (!icon) {
    throw new Error(`Unknown icon: ${name}`);
  }
  const [x, y, w, h] = icon.vb.split(/\s+/).map(Number);
  const paths = icon.ds.map((path, index) => (
    <path
      key={index}
      d={path.d}
      fill={path.fill || "currentColor"}
      fillRule="evenodd"
      clipRule="evenodd"
    />
  ));
  return (
    <svg
      width={size}
      height={size}
      viewBox={icon.vb}
      fill="none"
      style={style}
      className={className}
      aria-hidden="true"
    >
      {icon.rot ? (
        <g transform={`rotate(${icon.rot} ${x + w / 2} ${y + h / 2})`}>{paths}</g>
      ) : (
        paths
      )}
    </svg>
  );
}
