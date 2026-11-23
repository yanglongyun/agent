let chip: HTMLDivElement | null = null;
let line: HTMLDivElement | null = null;
let target: Element | null = null;
function ensure(kind: "chip" | "line"): HTMLDivElement {
  const existing = kind === "chip" ? chip : line;
  if (existing) {
    return existing;
  }
  const el = document.createElement("div");
  el.className = kind === "chip" ? "drag-chip" : "drop-line";
  document.body.appendChild(el);
  if (kind === "chip") {
    chip = el;
  } else {
    line = el;
  }
  return el;
}
export function moveDragChip(text: string, x: number, y: number) {
  const el = ensure("chip");
  if (el.textContent !== text) {
    el.textContent = text;
  }
  el.style.transform = `translate(${x + 12}px, ${y + 14}px)`;
}
export function showDropLine(x: number, y: number, width: number) {
  const el = ensure("line");
  el.style.transform = `translate(${x}px, ${y - 1}px)`;
  el.style.width = `${width}px`;
  el.style.display = "";
}
export function hideDropLine() {
  if (line) {
    line.style.display = "none";
  }
}
export function markDropTarget(el: Element | null) {
  if (target === el) {
    return;
  }
  target?.classList.remove("drop-target");
  target = el;
  target?.classList.add("drop-target");
}
export function clearDragVisuals() {
  chip?.remove();
  chip = null;
  line?.remove();
  line = null;
  target?.classList.remove("drop-target");
  target = null;
}
