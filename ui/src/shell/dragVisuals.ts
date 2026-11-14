// 拖拽的公共视觉件：跟手的标签、落点插入线、整块目标高亮。
// 三个件都是挂在 body 上的单例，pointer-events 全关，不会挡住命中判定。
let chip: HTMLDivElement | null = null;
let line: HTMLDivElement | null = null;
let target: Element | null = null;

function ensureChip() {
  if (!chip) {
    chip = document.createElement("div");
    chip.className = "drag-chip";
    document.body.appendChild(chip);
  }
  return chip;
}

function ensureLine() {
  if (!line) {
    line = document.createElement("div");
    line.className = "drop-line";
    document.body.appendChild(line);
  }
  return line;
}

/** 跟手的标签：显示被拖会话的标题，贴在指针右下。 */
export function moveDragChip(text: string, x: number, y: number) {
  const element = ensureChip();
  if (element.textContent !== text) {
    element.textContent = text;
  }
  element.style.transform = `translate(${x + 12}px, ${y + 14}px)`;
}

/** 落点线：画在两行之间的缝上。 */
export function showDropLine(x: number, y: number, width: number) {
  const element = ensureLine();
  element.style.transform = `translate(${x}px, ${y - 1}px)`;
  element.style.width = `${width}px`;
  element.style.display = "";
}

export function hideDropLine() {
  if (line) {
    line.style.display = "none";
  }
}

/** 整块高亮：落点是「整个区域」而不是「某条缝」时使用，同一时刻只高亮一个。 */
export function markDropTarget(element: Element | null) {
  if (target === element) {
    return;
  }
  target?.classList.remove("drop-target");
  target = element;
  target?.classList.add("drop-target");
}

/** 松手或取消时一次清干净。 */
export function clearDragVisuals() {
  chip?.remove();
  chip = null;
  line?.remove();
  line = null;
  target?.classList.remove("drop-target");
  target = null;
}
