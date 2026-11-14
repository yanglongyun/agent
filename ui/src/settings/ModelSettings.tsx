import { useState } from "react";
import { Icon } from "../icons/Icon";
import { Hint } from "../overlay/Hint";
import { Sheet } from "../overlay/Sheet";
import { toast } from "../overlay/toast";
import {
  modelEndpoints,
  protocolNames,
  type ModelProtocol,
  type ModelSettings,
} from "../lib/models";
import { Section } from "./sections";

export function ModelsSettings({
  models,
  onChange,
}: {
  models: ModelSettings[];
  onChange: (models: ModelSettings[]) => void;
}) {
  const [editing, setEditing] = useState<ModelSettings | null>(null);
  const [removing, setRemoving] = useState<ModelSettings | null>(null);
  return (
    <Section
      id="models"
      title="模型"
      description="分别添加模型连接，在对话输入框里随时切换。"
      action={
        <button
          className="btn btn-quiet sm"
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
          添加模型
        </button>
      }
    >
      {models.length ? (
        <div className="card settings-card">
          {models.map((model) => (
            <div className="model-row" key={model.id}>
              <span className="model-symbol">
                <Icon name="cpu" size={17} />
              </span>
              <div className="model-row-info">
                <strong className="clip">{model.name}</strong>
                <span className="clip">
                  {model.model} · {protocolNames[model.protocol]}
                </span>
              </div>
              <Hint text="编辑">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`编辑模型：${model.name}`}
                  onClick={() => setEditing(model)}
                >
                  <Icon name="pen" size={15} />
                </button>
              </Hint>
              <Hint text="删除">
                <button
                  type="button"
                  className="icon-btn model-remove"
                  aria-label={`删除模型：${model.name}`}
                  onClick={() => setRemoving(model)}
                >
                  <Icon name="trash" size={15} />
                </button>
              </Hint>
            </div>
          ))}
        </div>
      ) : (
        <div className="card empty">
          <Icon name="cpu" size={24} />
          <strong>还没有添加模型</strong>
          <span>添加模型后，即可开始对话。</span>
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
        <Sheet
          title="删除模型"
          onClose={() => setRemoving(null)}
          footer={
            <>
              <button className="btn btn-quiet" onClick={() => setRemoving(null)}>
                取消
              </button>
              <button
                className="btn btn-danger"
                onClick={() => {
                  onChange(models.filter((model) => model.id !== removing.id));
                  setRemoving(null);
                }}
              >
                删除模型
              </button>
            </>
          }
        >
          <p className="dialog-description">
            将从列表移除「{removing.name}
            」，历史对话和费用记录会保留。对话中已选用此模型时需重新选择。点击页面底部的「保存更改」后生效。
          </p>
        </Sheet>
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
  const [value, setValue] = useState(model);
  const [windowText, setWindowText] = useState(String(model.context_window));
  const [showKey, setShowKey] = useState(false);
  const save = () => {
    const context = Number(windowText);
    if (![value.name, value.url, value.model].every((item) => item.trim())) {
      toast("请填写名称、接口地址和模型 ID");
      return;
    }
    if (!value.key_set && !value.key.trim()) {
      toast("请填写 API Key");
      return;
    }
    if (!windowText.trim() || !Number.isSafeInteger(context) || context < 0 || context === 1) {
      toast("上下文窗口请填写 0 或大于 1 的整数");
      return;
    }
    try {
      if (!["http:", "https:"].includes(new URL(value.url).protocol)) {
        throw new Error();
      }
    } catch {
      toast("请填写有效的 HTTP 或 HTTPS 接口地址");
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
    <Sheet
      title={exists ? "编辑模型" : "添加模型"}
      className="model-editor"
      onClose={onClose}
      footer={
        <>
          <span className="model-editor-note">保存页面更改后生效</span>
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn btn-accent" onClick={save}>
            {exists ? "完成" : "添加"}
          </button>
        </>
      }
    >
      <div className="model-editor-form">
        <label className="field">
          名称
          <input
            className="field-input"
            value={value.name}
            data-autofocus
            placeholder="例如：日常对话、代码助手"
            onChange={(event) => setValue({ ...value, name: event.target.value })}
          />
        </label>
        <div className="field">
          协议
          <div className="seg fill" role="group" aria-label="协议">
            {(Object.keys(protocolNames) as ModelProtocol[]).map((protocol) => (
              <button
                key={protocol}
                type="button"
                className={`seg-item${value.protocol === protocol ? " selected" : ""}`}
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
          接口地址
          <input
            className="field-input mono"
            value={value.url}
            placeholder={modelEndpoints[value.protocol]}
            onChange={(event) => setValue({ ...value, url: event.target.value })}
          />
        </label>
        <label className="field">
          模型 ID
          <input
            className="field-input mono"
            value={value.model}
            placeholder="接口要求的模型 ID"
            onChange={(event) => setValue({ ...value, model: event.target.value })}
          />
        </label>
        <label className="field">
          API Key
          <div className="secret-field">
            <input
              className="field-input mono"
              type={showKey ? "text" : "password"}
              value={value.key}
              autoComplete="off"
              placeholder={value.key_set ? "已设置，留空保持不变" : "请输入 API Key"}
              onChange={(event) => setValue({ ...value, key: event.target.value })}
            />
            <button
              type="button"
              className="icon-btn sm"
              aria-label={showKey ? "隐藏 API Key" : "显示 API Key"}
              onClick={() => setShowKey(!showKey)}
            >
              <Icon name={showKey ? "eyeOff" : "eye"} size={15} />
            </button>
          </div>
        </label>
        <label className="field">
          上下文窗口（token）
          <input
            className="field-input"
            type="number"
            min={0}
            step={1}
            value={windowText}
            onChange={(event) => setWindowText(event.target.value)}
          />
          <small>0 表示未设置，按模型实际支持的长度填写。</small>
        </label>
      </div>
    </Sheet>
  );
}
