import "./Settings.css";
import { useEffect, useState } from "react";

import { api } from "../lib/api";
import { logout } from "../lib/auth";
import { setTheme, useTheme } from "../lib/theme";
import { toast } from "../overlay/toast";
import { ModelsSettings } from "./ModelSettings";
import type { ModelSettings } from "../lib/models";
import { Icon } from "../icons/Icon";
import { loadStatus, useThread } from "../thread/store";
import { AppBar } from "./AppBar";

interface ConfigView {
  models: Omit<ModelSettings, "key">[];
  system: string;
  compact_at: number;
  compact_on_cache_expiry: boolean;
  cache_ttl: number;
  keep: number;
  compact_system: string;
  compact_prefix: string;
  workdir: string;
  run_timeout: number;
  timeout: number;
  max_output: number;
  api: { listen: string };
  paths: { data_dir: string; config: string; web_dir: string };
}
interface Form {
  models: ModelSettings[];
  system: string;
  compact_at: string;
  compact_on_cache_expiry: boolean;
  cache_ttl: string;
  keep: string;
  compact_system: string;
  compact_prefix: string;
  workdir: string;
  run_timeout: string;
  timeout: string;
  max_output: string;
  listen: string;
}
type NumberField = "compact_at" | "cache_ttl" | "keep" | "run_timeout" | "timeout" | "max_output";
const toForm = (config: ConfigView): Form => ({
  models: config.models.map((model) => ({ ...model, key: "" })),
  system: config.system,
  compact_at: String(config.compact_at),
  compact_on_cache_expiry: config.compact_on_cache_expiry,
  cache_ttl: String(config.cache_ttl),
  keep: String(config.keep),
  compact_system: config.compact_system,
  compact_prefix: config.compact_prefix,
  workdir: config.workdir,
  run_timeout: String(config.run_timeout),
  timeout: String(config.timeout),
  max_output: String(config.max_output),
  listen: config.api.listen,
});

export function Settings() {
  const [config, setConfig] = useState<ConfigView | null>(null);
  const [value, setValue] = useState<Form | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const theme = useTheme((state) => state.mode);
  const status = useThread((state) => state.status);

  useEffect(() => {
    void api
      .get<ConfigView>("/api/config")
      .then((result) => {
        setConfig(result);
        setValue(toForm(result));
      })
      .catch((error) => toast(error instanceof Error ? error.message : "设置加载失败"))
      .finally(() => setLoading(false));
  }, []);

  function field<K extends keyof Form>(key: K, next: Form[K]) {
    setValue((current) => (current ? { ...current, [key]: next } : null));
  }
  const number = (key: NumberField) => {
    const input = value?.[key].trim();
    const result = Number(input);
    const minimum = 1;
    if (!input || !Number.isSafeInteger(result) || result < minimum) {
      throw new Error(`${key} 必须填写大于等于 ${minimum} 的整数`);
    }
    return result;
  };

  const save = async () => {
    if (!value) {
      return;
    }
    setSaving(true);
    try {
      const patch: Record<string, unknown> = {
        models: value.models.map(({ key_set, ...model }) => model),
        system: value.system,
        compact_at: number("compact_at"),
        compact_on_cache_expiry: value.compact_on_cache_expiry,
        cache_ttl: number("cache_ttl"),
        keep: number("keep"),
        compact_system: value.compact_system,
        compact_prefix: value.compact_prefix,
        workdir: value.workdir,
        run_timeout: number("run_timeout"),
        timeout: number("timeout"),
        max_output: number("max_output"),
        api: {
          listen: value.listen,
        },
      };
      const result = await api.put<{
        restart_required: boolean;
      }>("/api/config", patch);
      const saved = await api.get<ConfigView>("/api/config");
      setConfig(saved);
      setValue(toForm(saved));
      await loadStatus();
      toast(result.restart_required ? "设置已保存,服务参数需重启后生效" : "设置已保存", 2600);
    } catch (error) {
      toast(error instanceof Error ? error.message : "设置保存失败");
    } finally {
      setSaving(false);
    }
  };

  const numberField = (label: string, key: NumberField, note: string, min = 1) => (
    <label>
      <span>{label}</span>
      <div>
        <input
          className="field-input"
          type="number"
          min={min}
          step={1}
          value={value?.[key] ?? ""}
          onChange={(event) => field(key, event.target.value)}
        />
        <p className="sheet-note">{note}</p>
      </div>
    </label>
  );

  return (
    <section className="settings-page">
      <AppBar title="设置" />
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="设置分区">
          <span className="settings-nav-label">工作区设置</span>
          <a href="#models">
            <Icon name="cpu" size={16} />
            模型连接
          </a>
          <a href="#instructions">
            <Icon name="doc" size={16} />
            系统指令
          </a>
          <a href="#compression">
            <Icon name="layers" size={16} />
            上下文压缩
          </a>
          <a href="#execution">
            <Icon name="terminal" size={16} />
            执行环境
          </a>
          <a href="#appearance">
            <Icon name="sliders" size={16} />
            外观与服务
          </a>
        </nav>
        <main className="settings-content">
          <div className="settings-panel">
            <div className="settings-heading">
              <h1>设置</h1>
              <p>管理模型连接、上下文与工作环境。</p>
            </div>
            {loading ? (
              <div className="sheet-note">正在读取设置…</div>
            ) : !config || !value ? (
              <p className="sheet-error">设置读取失败，请重新打开设置。</p>
            ) : (
              <>
                <section className="settings-section" id="models">
                  <ModelsSettings
                    models={value.models}
                    onChange={(models) => field("models", models)}
                  />
                </section>
                <section className="settings-section" id="instructions">
                  <h2 className="settings-section-title">指令</h2>
                  <div className="settings-form">
                    <label>
                      <span>主提示词</span>
                      <div>
                        <textarea
                          className="field-input settings-prompt"
                          rows={8}
                          value={value.system}
                          onChange={(event) => field("system", event.target.value)}
                        />
                        <p className="sheet-note">
                          当前环境和时间随消息提供给模型，系统提示词保持固定。
                        </p>
                      </div>
                    </label>
                  </div>
                </section>
                <section className="settings-section" id="compression">
                  <h2 className="settings-section-title">压缩</h2>
                  <div className="settings-form">
                    <p className="sheet-note">
                      压缩模型在对话输入框中选择；以下设置控制压缩时机和内容。
                    </p>
                    <label className="settings-checkbox">
                      <input
                        type="checkbox"
                        checked={value.compact_on_cache_expiry}
                        onChange={(event) => field("compact_on_cache_expiry", event.target.checked)}
                      />
                      <span>缓存过期时压缩</span>
                    </label>
                    <p className="sheet-note">
                      上次模型响应结束后超过设定有效期，在下一次请求前压缩。最近消息按保留条数保留。
                    </p>
                    {numberField(
                      "缓存有效期(秒)",
                      "cache_ttl",
                      "用于判断过期，不改变接口的缓存策略。Claude 当前默认 300 秒，其他接口按实际有效期填写。",
                    )}
                    {numberField(
                      "压缩阈值(token)",
                      "compact_at",
                      "达到此用量时总结早期上下文，触发值同时受所选模型窗口限制。",
                    )}
                    {numberField("压缩后保留条数", "keep", "压缩时保留最近的消息条数。")}
                    <label>
                      <span>压缩提示词</span>
                      <textarea
                        className="field-input settings-prompt"
                        rows={4}
                        value={value.compact_system}
                        onChange={(event) => field("compact_system", event.target.value)}
                      />
                    </label>
                    <label>
                      <span>压缩摘要前缀</span>
                      <textarea
                        className="field-input settings-prompt"
                        rows={2}
                        value={value.compact_prefix}
                        onChange={(event) => field("compact_prefix", event.target.value)}
                      />
                    </label>
                  </div>
                </section>
                <section className="settings-section" id="execution">
                  <h2 className="settings-section-title">执行</h2>
                  <div className="settings-form">
                    <label>
                      <span>工作目录</span>
                      <div>
                        <input
                          className="field-input mono"
                          value={value.workdir}
                          placeholder="留空使用服务启动时的目录"
                          onChange={(event) => field("workdir", event.target.value)}
                        />
                        <p className="sheet-note">
                          Agent 执行命令和读写文件的默认目录,必须已存在。
                        </p>
                      </div>
                    </label>
                    {numberField("回复超时(秒)", "run_timeout", "一次完整回复的最长时间。")}
                    {numberField("命令超时(秒)", "timeout", "shell 工具单次执行的最长时间。")}
                    {numberField(
                      "工具输出上限(字符)",
                      "max_output",
                      "单次工具结果保留的最多字符数,超出截断。",
                    )}
                  </div>
                </section>
                <section className="settings-section" id="appearance">
                  <h2 className="settings-section-title">界面</h2>
                  <div className="theme-options" role="group" aria-label="界面主题">
                    {(
                      [
                        { mode: "light", label: "浅色", icon: "sun" },
                        { mode: "dark", label: "深色", icon: "moon" },
                        { mode: "auto", label: "跟随系统", icon: "monitor" },
                      ] as const
                    ).map((option) => (
                      <button
                        key={option.mode}
                        type="button"
                        className={`theme-option${theme === option.mode ? " selected" : ""}`}
                        aria-pressed={theme === option.mode}
                        onClick={() => setTheme(option.mode)}
                      >
                        <Icon name={option.icon} size={21} />
                        <span>{option.label}</span>
                        {theme === option.mode && <Icon name="check" size={14} />}
                      </button>
                    ))}
                  </div>
                </section>
                <section className="settings-section" id="service">
                  <h2 className="settings-section-title">服务</h2>
                  <p className="sheet-note">这一组修改后需要重启服务:agent restart。</p>
                  <div className="settings-form">
                    <label>
                      <span>监听地址</span>
                      <input
                        className="field-input mono"
                        value={value.listen}
                        onChange={(event) => field("listen", event.target.value)}
                      />
                    </label>
                  </div>
                </section>
                <section className="settings-section" id="locations">
                  <h2 className="settings-section-title">位置</h2>
                  <div className="settings-kv">
                    <div>
                      <span>版本</span>
                      <b>{status?.version || ""}</b>
                    </div>
                    <div>
                      <span>数据目录</span>
                      <b>{config.paths.data_dir}</b>
                    </div>
                    <div>
                      <span>配置文件</span>
                      <b>{config.paths.config}</b>
                    </div>
                    <div>
                      <span>界面</span>
                      <b>{config.paths.web_dir || "内置"}</b>
                    </div>
                  </div>
                </section>
                <section className="settings-section" id="account">
                  <h2 className="settings-section-title">账户</h2>
                  <div className="settings-theme">
                    <span>当前浏览器已使用访问令牌登录。</span>
                    <button className="btn btn-quiet" onClick={() => void logout()}>
                      退出登录
                    </button>
                  </div>
                </section>
              </>
            )}
          </div>
        </main>
      </div>
      <footer className="settings-actions">
        <span>
          {value && config && JSON.stringify(value) !== JSON.stringify(toForm(config))
            ? "有未保存的更改"
            : "设置已同步"}
        </span>
        <button
          className="btn btn-accent"
          disabled={
            loading ||
            saving ||
            !value ||
            !config ||
            JSON.stringify(value) === JSON.stringify(toForm(config))
          }
          onClick={() => void save()}
        >
          {saving ? (
            <>
              <Icon name="loading" className="spin" size={15} />
              保存中…
            </>
          ) : (
            "保存更改"
          )}
        </button>
      </footer>
    </section>
  );
}
