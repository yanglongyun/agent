import {
  Paperclip,
  SquarePen,
  PanelLeft,
  ArrowUp,
  Square,
  ChevronRight,
  Terminal,
  FileText,
  Pencil,
  Sparkles,
  Trash2,
  Copy,
  GitBranch,
  Settings2,
  Search,
  Ellipsis,
  X,
  ArrowDown,
  Folder,
  Sun,
  Moon,
  Monitor,
  Check,
  CircleAlert,
  LogOut,
  CircleHelp,
  Plus,
  LoaderCircle,
  ArrowRight,
  ChevronDown,
  MessagesSquare,
  Code2,
  Lightbulb,
  SlidersHorizontal,
  Cpu,
  Layers,
  Link,
  ExternalLink,
  Download,
  Pin,
  PinOff,
  LayoutGrid,
  ScrollText,
  ArrowLeft,
} from "lucide-react";

// 全部界面使用 Lucide 同一套描边图标，按需打包。
const glyphs = {
  attachment: Paperclip,
  compose: SquarePen,
  panel: PanelLeft,
  send: ArrowUp,
  stop: Square,
  chev: ChevronRight,
  terminal: Terminal,
  doc: FileText,
  pen: Pencil,
  spark: Sparkles,
  trash: Trash2,
  copy: Copy,
  branch: GitBranch,
  settings: Settings2,
  search: Search,
  more: Ellipsis,
  close: X,
  down: ArrowDown,
  folder: Folder,
  sun: Sun,
  moon: Moon,
  monitor: Monitor,
  check: Check,
  alert: CircleAlert,
  logout: LogOut,
  help: CircleHelp,
  plus: Plus,
  loading: LoaderCircle,
  arrow: ArrowRight,
  chevronDown: ChevronDown,
  messages: MessagesSquare,
  code: Code2,
  idea: Lightbulb,
  sliders: SlidersHorizontal,
  cpu: Cpu,
  layers: Layers,
  link: Link,
  external: ExternalLink,
  download: Download,
  pin: Pin,
  pinOff: PinOff,
  grid: LayoutGrid,
  logs: ScrollText,
  back: ArrowLeft,
};
export type IconName = keyof typeof glyphs;
export function Icon({
  name,
  size = 18,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  const Glyph = glyphs[name];
  return <Glyph size={size} strokeWidth={1.75} className={className} aria-hidden="true" />;
}
export function Mark({ size = 30 }: { size?: number }) {
  return (
    <span className="brand-mark" style={{ width: size, height: size }} aria-hidden="true">
      <Terminal size={Math.round(size * 0.57)} strokeWidth={2} />
    </span>
  );
}
