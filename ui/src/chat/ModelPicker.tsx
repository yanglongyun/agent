import { useEffect, useRef, useState } from "react";
import openaiLogo from "@/icons/openai.svg";
import claudeLogo from "@/icons/claude.svg";
import geminiLogo from "@/icons/gemini.svg";
import { Icon } from "@/icons/Icon";
import { useNavigate } from "@/lib/router";
import { selectedModel, selectModel, useThread } from "@/thread/store";
import { useT } from "@/i18n";
import type { ModelInfo } from "@/lib/models";

// 选择器必须返回稳定引用：空列表用同一个常量，否则 React 会因快照不断变化而死循环。
const NO_MODELS: ModelInfo[] = [];

// 没有厂商字段，按协议和模型名猜一个标志；猜不出就用通用图标。
function logo(model: { model: string; protocol: string }): string | null {
  if (model.protocol === "anthropic-messages" || /claude/i.test(model.model)) {
    return claudeLogo;
  }
  if (/gemini/i.test(model.model)) {
    return geminiLogo;
  }
  if (/^(gpt|o\d|chatgpt)/i.test(model.model)) {
    return openaiLogo;
  }
  return null;
}

export function ModelPicker() {
  const t = useT();
  const navigate = useNavigate();
  const models = useThread((state) => state.status?.models || NO_MODELS);
  const current = useThread((state) => selectedModel(state));
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onDown = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  if (!models.length) {
    return (
      <button
        className="model-btn warn"
        title={t("model.add")}
        onClick={() => navigate("/settings")}
      >
        <Icon name="settings" size={14} />
        <span>{t("model.add")}</span>
      </button>
    );
  }
  const active = current || models[0];
  return (
    <div className="model" ref={boxRef}>
      <button
        className={`model-btn${open ? " on" : ""}`}
        title={t("agent.model")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {logo(active) ? (
          <img className="model-logo" src={logo(active)!} alt="" aria-hidden="true" />
        ) : (
          <Icon name="think" size={15} />
        )}
        <span>{active.name}</span>
        <Icon name="chevronDown" size={12} />
      </button>

      {open && (
        <div className="model-menu" role="menu">
          {models.map((model) => (
            <button
              key={model.id}
              role="menuitemradio"
              aria-checked={model.id === active.id}
              className={model.id === active.id ? "on" : ""}
              onClick={() => {
                selectModel(model.id);
                setOpen(false);
              }}
            >
              {logo(model) ? (
                <img className="model-logo" src={logo(model)!} alt="" aria-hidden="true" />
              ) : (
                <Icon name="think" size={15} />
              )}
              <b>{model.name}</b>
              <span>{model.model}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
