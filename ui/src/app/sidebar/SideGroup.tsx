import type { ReactNode } from "react";
import { useShell } from "@/app/layout";
export function SideGroup({
  id,
  label,
  gap,
  children,
}: {
  id: string;
  label: string;
  gap?: boolean;
  children: ReactNode;
}) {
  const folded = useShell((state) => Boolean(state.folded[id]));
  const toggleFold = useShell((state) => state.toggleFold);
  return (
    <>
      <button
        className={`side-label side-fold${gap ? " side-label-gap" : ""}${folded ? " folded" : ""}`}
        aria-expanded={!folded}
        onClick={() => toggleFold(id)}
      >
        <span>{label}</span>

        <i className="side-chevron" />
      </button>
      {!folded && children}
    </>
  );
}
