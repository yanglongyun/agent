import { useState } from "react";
import { Icon } from "@/icons/Icon";
import { Dialog } from "@/overlay/Dialog";
import { useToast } from "@/overlay/toast";
import { useT } from "@/i18n";
import { Section } from "./layout";
import {
  modelEndpoints,
  protocolNames,
  type ModelProtocol,
  type ModelSettings,
} from "@/lib/models";

export function ModelsSection({
  models,
  onChange,
}: {
  models: ModelSettings[];
  onChange: (models: ModelSettings[]) => void;
}) {
  const t = useT();
  const [editing, setEditing] = useState<ModelSettings | null>(null);
  const [removing, setRemoving] = useState<ModelSettings | null>(null);
  return (
    <Section
      title={t("models.title")}
      action={
        <button
          className="btn btn-plain"
          type="button"
          onClick={() =>
            setEditing({
              id: crypto.randomUUID(),
              name: "",
              model: "",
              protocol: "responses",
              url: modelEndpoints.responses,
              key: "",
              key_set: false,
              context_window: 0,
            })
          }
        >
          <Icon name="plus" size={14} />
          {t("models.add")}
        </button>
      }
    >
      {models.length ? (
        <div className="card settings-card">
          {models.map((model) => (
            <div className="model-row" key={model.id}>
              <span className="model-symbol">
                <Icon name="think" size={17} />
              </span>
              <div className="model-row-info">
                <strong className="clip">{model.name}</strong>
                <span className="clip">
                  {model.model} · {protocolNames[model.protocol]}
                </span>
              </div>
              <button
                type="button"
                className="icon-btn"
                aria-label={`${t("models.edit")}：${model.name}`}
                onClick={() => setEditing(model)}
              >
                <Icon name="pencil" size={15} />
              </button>
              <button
                type="button"
                className="icon-btn model-remove"
                aria-label={`${t("common.delete")}：${model.name}`}
                onClick={() => setRemoving(model)}
              >
                <Icon name="trash" size={15} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="card empty">
          <Icon name="think" size={24} />
          <strong>{t("models.none")}</strong>
          <span>{t("models.noneHint")}</span>
        </div>
      )}
      {editing && (
        <ModelEditor
          key={editing.id}
          model={editing}
          exists={models.some((model) => model.id === editing.id)}
          onClose={() => setEditing(null)}
          onSave={(model) => {
            const exists = models.some((item) => item.id === model.id);
            onChange(
              exists
                ? models.map((item) => (item.id === model.id ? model : item))
                : [...models, model],
            );
            setEditing(null);
          }}
        />
      )}
      {removing && (
        <Dialog title={t("models.removeTitle")} close={() => setRemoving(null)}>
          <p className="confirm-message">{t("models.removeConfirm", { name: removing.name })}</p>
          <div className="modal-foot">
            <button className="btn btn-plain" onClick={() => setRemoving(null)}>
              {t("common.cancel")}
            </button>
            <button
              className="btn btn-danger"
              onClick={() => {
                onChange(models.filter((model) => model.id !== removing.id));
                setRemoving(null);
              }}
            >
              {t("common.delete")}
            </button>
          </div>
        </Dialog>
      )}
    </Section>
  );
}

const protocolShort: Record<ModelProtocol, string> = {
  responses: "Responses",
  "chat-completions": "Chat Completions",
  "anthropic-messages": "Claude Messages",
};

function ModelEditor({
  model,
  exists,
  onClose,
  onSave,
}: {
  model: ModelSettings;
  exists: boolean;
  onClose: () => void;
  onSave: (model: ModelSettings) => void;
}) {
  const t = useT();
  const [value, setValue] = useState(model);
  const [windowText, setWindowText] = useState(String(model.context_window));
  const [showKey, setShowKey] = useState(false);
  const save = () => {
    const context = Number(windowText);
    if (![value.name, value.url, value.model].every((item) => item.trim())) {
      useToast.getState().show(t("models.needBasics"));
      return;
    }
    if (!value.key_set && !value.key.trim()) {
      useToast.getState().show(t("models.needKey"));
      return;
    }
    if (!windowText.trim() || !Number.isSafeInteger(context) || context < 0 || context === 1) {
      useToast.getState().show(t("models.badWindow"));
      return;
    }
    try {
      if (!["http:", "https:"].includes(new URL(value.url).protocol)) {
        throw new Error();
      }
    } catch {
      useToast.getState().show(t("models.badUrl"));
      return;
    }
    onSave({
      ...value,
      name: value.name.trim(),
      url: value.url.trim(),
      model: value.model.trim(),
      key: value.key.trim(),
      context_window: context,
    });
  };
  return (
    <Dialog title={exists ? t("models.edit") : t("models.add")} close={onClose}>
      <div className="model-editor-form">
        <label className="field">
          {t("models.name")}
          <input
            className="input"
            value={value.name}
            autoFocus
            placeholder={t("models.namePlaceholder")}
            onChange={(event) => setValue({ ...value, name: event.target.value })}
          />
        </label>
        <div className="field">
          {t("models.protocol")}
          <div className="set-segment" role="group" aria-label={t("models.protocol")}>
            {(Object.keys(protocolNames) as ModelProtocol[]).map((protocol) => (
              <button
                key={protocol}
                type="button"
                className={value.protocol === protocol ? "on" : ""}
                aria-pressed={value.protocol === protocol}
                onClick={() =>
                  setValue({
                    ...value,
                    protocol,
                    // 接口地址还是上一个协议的默认值时，跟着换成新协议的默认值
                    url:
                      value.url === modelEndpoints[value.protocol]
                        ? modelEndpoints[protocol]
                        : value.url,
                  })
                }
              >
                {protocolShort[protocol]}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          {t("models.url")}
          <input
            className="input mono"
            value={value.url}
            placeholder={modelEndpoints[value.protocol]}
            onChange={(event) => setValue({ ...value, url: event.target.value })}
          />
        </label>
        <label className="field">
          {t("models.modelId")}
          <input
            className="input mono"
            value={value.model}
            placeholder={t("models.modelIdPlaceholder")}
            onChange={(event) => setValue({ ...value, model: event.target.value })}
          />
        </label>
        <label className="field">
          {t("models.key")}
          <span className="secret-field">
            <input
              className="input mono"
              type={showKey ? "text" : "password"}
              autoComplete="off"
              value={value.key}
              placeholder={value.key_set ? t("models.keySaved") : t("models.keyPlaceholder")}
              onChange={(event) => setValue({ ...value, key: event.target.value })}
            />
            <button
              type="button"
              className="icon-btn"
              aria-label={t("models.showKey")}
              onClick={() => setShowKey(!showKey)}
            >
              <Icon name="read" size={15} />
            </button>
          </span>
        </label>
        <label className="field">
          {t("models.contextWindow")}
          <input
            className="input mono"
            type="number"
            min={0}
            step={1}
            value={windowText}
            onChange={(event) => setWindowText(event.target.value)}
          />
          <small>{t("models.contextWindowHint")}</small>
        </label>
      </div>
      <div className="modal-foot">
        <span className="model-editor-note">{t("models.editorNote")}</span>
        <button type="button" className="btn btn-plain" onClick={onClose}>
          {t("common.cancel")}
        </button>
        <button type="button" className="btn btn-primary" onClick={save}>
          {exists ? t("common.save") : t("models.add")}
        </button>
      </div>
    </Dialog>
  );
}
