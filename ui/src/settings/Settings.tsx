import { useEffect, useRef, useState } from "react";

import { api } from "../lib/api";
import { logout } from "../lib/auth";
import { setTheme, useTheme } from "../lib/theme";
import { toast } from "../overlay/toast";
import { ModelsSettings } from "./ModelSettings";
import type { ModelSettings } from "../lib/models";
import { Icon } from "../icons/Icon";
import { StageHead } from "../shell/heads";
import { loadStatus, useThread } from "../thread/store";
import { Section, SettingRow, sections, useSettingsNav } from "./sections";

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
  const scroller = useRef<HTMLElement>(null);

  // 滚动时把最靠近顶部的分区标成当前分区，列表栏据此高亮；滚到底时算最后一个。
  const trackSection = () => {
    const element = scroller.current;
    if (!element) {
      return;
    }
    let active = sections[0].id;
    if (element.scrollTop + element.clientHeight >= element.scrollHeight - 4) {
      active = sections[sections.length - 1].id;
    } else {
      const top = element.getBoundingClientRect().top;
      for (const section of sections) {
        const node = document.getElementById(section.id);
        if (node && node.getBoundingClientRect().top - top <= 96) {
          active = section.id;
        }
      }
    }
    if (useSettingsNav.getState().active !== active) {
      useSettingsNav.setState({ active });
    }
  };
  useEffect(() => {
    useSettingsNav.setState({ active: sections[0].id });
  }, []);

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

  const numberField = (label: string, key: NumberField, note: string) => (
    <SettingRow label={label} note={note}>
      <input
        className="field-input setting-number"
        type="number"
        min={1}
        step={1}
        value={value?.[key] ?? ""}
        onChange={(event) => field(key, event.target.value)}
      />
    </SettingRow>
  );
  const dirty = Boolean(
    value && config && JSON.stringify(value) !== JSON.stringify(toForm(config)),
  );

  return (
    <section className="stage">
      <StageHead title="设置" />
      <main ref={scroller} className="stage-scroll settings-scroll" onScroll={trackSection}>
        <div className="page settings-page">
          {loading && <p className="note">正在读取设置…</p>}
          {!loading && (!config || !value) && (
            <p className="note is-error">设置读取失败，请刷新页面重试。</p>
          )}
          {config && value && (
            <>
              <ModelsSettings
                models={value.models}
                onChange={(models) => field("models", models)}
              />

              <Section
                id="instructions"
                title="指令"
                description="每次对话都会带上的系统提示词。当前环境和时间随消息提供给模型，提示词保持固定。"
              >
                <textarea
                  className="field-input settings-prompt"
                  rows={9}
                  aria-label="主提示词"
                  value={value.system}
                  onChange={(event) => field("system", event.target.value)}
                />
              </Section>

              <Section
                id="compression"
                title="上下文压缩"
                description="对话变长后把早期内容总结成摘要。压缩使用对话当前选择的模型。"
              >
                <div className="card settings-card">
                  {numberField(
                    "压缩阈值",
                    "compact_at",
                    "上下文达到这么多 token 时压缩，同时受所选模型的窗口限制。",
                  )}
                  {numberField("保留条数", "keep", "压缩时原样保留最近的消息条数。")}
                  <SettingRow
                    label="缓存过期时压缩"
                    note="上次模型响应结束后超过缓存有效期，就在下一次请求前压缩。"
                  >
                    <input
                      type="checkbox"
                      className="switch"
                      checked={value.compact_on_cache_expiry}
                      onChange={(event) => field("compact_on_cache_expiry", event.target.checked)}
                    />
                  </SettingRow>
                  {numberField(
                    "缓存有效期（秒）",
                    "cache_ttl",
                    "只用于判断过期，不改变接口的缓存策略。Claude 默认 300 秒。",
                  )}
                  <SettingRow label="压缩提示词" stack>
                    <textarea
                      className="field-input settings-prompt"
                      rows={4}
                      value={value.compact_system}
                      onChange={(event) => field("compact_system", event.target.value)}
                    />
                  </SettingRow>
                  <SettingRow
                    label="摘要前缀"
                    note="放在摘要前面，告诉模型这是压缩后的历史。"
                    stack
                  >
                    <textarea
                      className="field-input settings-prompt"
                      rows={2}
                      value={value.compact_prefix}
                      onChange={(event) => field("compact_prefix", event.target.value)}
                    />
                  </SettingRow>
                </div>
              </Section>

              <Section
                id="execution"
                title="执行环境"
                description="Agent 执行命令和读写文件时的限制。"
              >
                <div className="card settings-card">
                  <SettingRow
                    label="工作目录"
                    note="执行命令和读写文件的默认目录，必须已存在。留空使用服务启动时的目录。"
                    stack
                  >
                    <input
                      className="field-input mono"
                      value={value.workdir}
                      placeholder="留空使用服务启动时的目录"
                      onChange={(event) => field("workdir", event.target.value)}
                    />
                  </SettingRow>
                  {numberField("回复超时（秒）", "run_timeout", "一次完整回复的最长时间。")}
                  {numberField("命令超时（秒）", "timeout", "shell 工具单次执行的最长时间。")}
                  {numberField(
                    "工具输出上限（字符）",
                    "max_output",
                    "单次工具结果最多保留的字符数，超出截断。",
                  )}
                </div>
              </Section>

              <Section id="appearance" title="外观">
                <div className="card settings-card">
                  <div className="setting-row">
                    <span className="setting-text">
                      <span className="setting-label">主题</span>
                      <span className="setting-note">只保存在当前浏览器，立即生效。</span>
                    </span>
                    <div className="seg" role="group" aria-label="界面主题">
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
                          className={`seg-item${theme === option.mode ? " selected" : ""}`}
                          aria-pressed={theme === option.mode}
                          onClick={() => setTheme(option.mode)}
                        >
                          <Icon name={option.icon} size={14} />
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </Section>

              <Section
                id="service"
                title="服务"
                description="修改后需要重启服务才生效：agent restart。"
              >
                <div className="card settings-card">
                  <SettingRow label="监听地址">
                    <input
                      className="field-input mono setting-wide"
                      value={value.listen}
                      onChange={(event) => field("listen", event.target.value)}
                    />
                  </SettingRow>
                </div>
              </Section>

              <Section id="about" title="关于">
                <div className="card settings-card">
                  <dl className="kv settings-kv">
                    <div>
                      <dt>版本</dt>
                      <dd>{status?.version ? `v${status.version}` : ""}</dd>
                    </div>
                    <div>
                      <dt>数据目录</dt>
                      <dd className="mono">{config.paths.data_dir}</dd>
                    </div>
                    <div>
                      <dt>配置文件</dt>
                      <dd className="mono">{config.paths.config}</dd>
                    </div>
                    <div>
                      <dt>界面</dt>
                      <dd className="mono">{config.paths.web_dir || "内置"}</dd>
                    </div>
                  </dl>
                </div>
              </Section>

              <Section id="account" title="账户">
                <div className="card settings-card">
                  <div className="setting-row">
                    <span className="setting-text">
                      <span className="setting-label">访问令牌</span>
                      <span className="setting-note">当前浏览器已使用访问令牌登录。</span>
                    </span>
                    <button type="button" className="btn btn-quiet" onClick={() => void logout()}>
                      <Icon name="logout" size={15} />
                      退出登录
                    </button>
                  </div>
                </div>
              </Section>
            </>
          )}
        </div>
      </main>
      {dirty && (
        <div className="save-bar" role="region" aria-label="保存更改">
          <span>有未保存的更改</span>
          <button
            type="button"
            className="btn btn-ghost sm"
            disabled={saving}
            onClick={() => config && setValue(toForm(config))}
          >
            放弃
          </button>
          <button
            type="button"
            className="btn btn-accent sm"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? (
              <>
                <Icon name="loading" className="spin" size={14} />
                保存中…
              </>
            ) : (
              "保存更改"
            )}
          </button>
        </div>
      )}
    </section>
  );
}
