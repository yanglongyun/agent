import { useShell } from "./layout";
export function Resizer({ target }: { target: "sidebar" }) {
  return (
    <div
      className="col-resizer"
      data-target={target}
      onPointerDown={(event) => {
        if (event.button !== 0) {
          return;
        }
        event.preventDefault();
        const element = event.currentTarget;
        const start = event.clientX;
        const width = element.parentElement!.getBoundingClientRect().width;
        element.setPointerCapture(event.pointerId);
        const move = (next: PointerEvent) =>
          useShell.getState().setSidebarWidth(width + next.clientX - start);
        const end = () => {
          element.removeEventListener("pointermove", move);
          element.removeEventListener("pointerup", end);
          element.removeEventListener("pointercancel", end);
        };
        element.addEventListener("pointermove", move);
        element.addEventListener("pointerup", end);
        element.addEventListener("pointercancel", end);
      }}
    />
  );
}
