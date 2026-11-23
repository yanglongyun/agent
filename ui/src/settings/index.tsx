import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { logout } from "@/lib/auth";
import { toast } from "@/overlay/toast";
import { useShell } from "@/app/layout";
import { THEMES, useTheme } from "@/app/theme";
import { loadStatus } from "@/thread/store";
import { Icon } from "@/icons/Icon";
import { useT, useLang, setLang, type Lang } from "@/i18n";
import { ModelsSection } from "./Models";
import { Row, Section } from "./layout";
import type { ModelSettings } from "@/lib/models";

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
  timeout: number;
  max_output: number;
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
  timeout: string;
  max_output: string;
}
type NumberField = "compact_at" | "cache_ttl" | "keep" | "timeout" | "max_output";
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
  timeout: String(config.timeout),
  max_output: String(config.max_output),
});

export default function SettingsApp() {
  const t = useT();
  const shell = useShell();
  const { theme, setTheme } = useTheme();
  const lang = useLang((state) => state.lang);
  const [config, setConfig] = useState<ConfigView | null>(null);
  const [value, setValue] = useState<Form | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api
      .get<ConfigView>("/api/config")
      .then((result) => {
        setConfig(result);
        setValue(toForm(result));
      })
      .catch((error) => toast(error instanceof Error ? error.message : t("settings.loadFailed")))
      .finally(() => setLoading(false));
  }, []);

  function field<K extends keyof Form>(key: K, next: Form[K]) {
    setValue((current) => (current ? { ...current, [key]: next } : null));
  }
  const number = (key: NumberField) => {
    const input = value?.[key].trim();
    const result = Number(input);
    if (!input || !Number.isSafeInteger(result) || result < 1) {
      throw new Error(t("settings.badNumber", { key }));
    }
    return result;
  };

  const save = async () => {
    if (!value) {
      return;
    }
    setSaving(true);
    try {
      await api.put("/api/config", {
        models: value.models.map(({ key_set, ...model }) => model),
        system: value.system,
        compact_at: number("compact_at"),
        compact_on_cache_expiry: value.compact_on_cache_expiry,
        cache_ttl: number("cache_ttl"),
        keep: number("keep"),
        compact_system: value.compact_system,
        compact_prefix: value.compact_prefix,
        workdir: value.workdir,
        timeout: number("timeout"),
        max_output: number("max_output"),
      });
      const saved = await api.get<ConfigView>("/api/config");
      setConfig(saved);
      setValue(toForm(saved));
      await loadStatus();
      toast(t("settings.saved"), 2600);
    } catch (error) {
      toast(error instanceof Error ? error.message : t("settings.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const numberField = (label: string, key: NumberField, hint: string) => (
    <Row label={label} hint={hint}>
      <input
        className="input mono set-number"
        type="number"
        min={1}
        step={1}
        value={value?.[key] ?? ""}
        onChange={(event) => field(key, event.target.value)}
      />
    </Row>
  );
  const dirty = Boolean(
    value && config && JSON.stringify(value) !== JSON.stringify(toForm(config)),
  );

  return (
    <div className="app">
      <header className="topbar">
        <button
          className={`icon-btn menu-btn${shell.collapsed ? " show" : ""}`}
          title={t("side.openSidebar")}
          onClick={shell.openMenu}
        >
          <Icon name="panel" size={17} />
        </button>
        <span className="title">{t("settings.title")}</span>
      </header>

      <main className="page" aria-label={t("settings.title")}>
        <div className="settings-inner">
          {loading && <p className="note">{t("settings.loading")}</p>}
          {!loading && (!config || !value) && (
            <p className="note is-error">{t("settings.loadFailed")}</p>
          )}
          {config && value && (
            <>
              <ModelsSection models={value.models} onChange={(models) => field("models", models)} />

              <Section title={t("instructions.title")}>
                <div className="set-group">
                  <Row label={t("instructions.system")} hint={t("instructions.hint")}>
                    <textarea
                      className="input mono set-prompt"
                      rows={9}
                      aria-label={t("instructions.system")}
                      value={value.system}
                      onChange={(event) => field("system", event.target.value)}
                    />
                  </Row>
                </div>
              </Section>

              <Section title={t("compression.title")}>
                <div className="set-group">
                  {numberField(
                    t("compression.threshold"),
                    "compact_at",
                    t("compression.thresholdHint"),
                  )}
                  {numberField(t("compression.keep"), "keep", t("compression.keepHint"))}
                  <Row
                    keep
                    label={t("compression.cacheExpiry")}
                    hint={t("compression.cacheExpiryHint")}
                  >
                    <button
                      className={`set-switch${value.compact_on_cache_expiry ? " on" : ""}`}
                      role="switch"
                      aria-label={t("compression.cacheExpiry")}
                      aria-checked={value.compact_on_cache_expiry}
                      onClick={() =>
                        field("compact_on_cache_expiry", !value.compact_on_cache_expiry)
                      }
                    >
                      <i />
                    </button>
                  </Row>
                  {numberField(
                    t("compression.cacheTtl"),
                    "cache_ttl",
                    t("compression.cacheTtlHint"),
                  )}
                  <Row label={t("compression.prompt")} hint={t("compression.promptHint")}>
                    <textarea
                      className="input mono set-prompt"
                      rows={4}
                      value={value.compact_system}
                      onChange={(event) => field("compact_system", event.target.value)}
                    />
                  </Row>
                  <Row label={t("compression.prefix")} hint={t("compression.prefixHint")}>
                    <textarea
                      className="input mono set-prompt"
                      rows={2}
                      value={value.compact_prefix}
                      onChange={(event) => field("compact_prefix", event.target.value)}
                    />
                  </Row>
                </div>
              </Section>

              <Section title={t("execution.title")}>
                <div className="set-group">
                  <Row label={t("execution.workdir")} hint={t("execution.workdirHint")}>
                    <input
                      className="input mono"
                      value={value.workdir}
                      placeholder={t("execution.workdirPlaceholder")}
                      onChange={(event) => field("workdir", event.target.value)}
                    />
                  </Row>
                  {numberField(t("execution.timeout"), "timeout", t("execution.timeoutHint"))}
                  {numberField(
                    t("execution.maxOutput"),
                    "max_output",
                    t("execution.maxOutputHint"),
                  )}
                </div>
              </Section>
            </>
          )}

          <Section title={t("general.title")}>
            <div className="set-group">
              <Row label={t("settings.language")} hint={t("settings.languageHint")}>
                <div className="set-segment">
                  {(["zh", "en"] as Lang[]).map((item) => (
                    <button
                      key={item}
                      type="button"
                      className={lang === item ? "on" : ""}
                      aria-pressed={lang === item}
                      onClick={() => setLang(item)}
                    >
                      {t(item === "zh" ? "settings.langZh" : "settings.langEn")}
                    </button>
                  ))}
                </div>
              </Row>
              <Row label={t("general.appearance")}>
                <div className="set-segment">
                  {THEMES.map((item) => (
                    <button
                      key={item}
                      type="button"
                      className={theme === item ? "on" : ""}
                      aria-pressed={theme === item}
                      onClick={() => setTheme(item)}
                    >
                      {t(
                        item === "system"
                          ? "general.themeSystem"
                          : item === "sky"
                            ? "general.themeSky"
                            : "general.themeNight",
                      )}
                    </button>
                  ))}
                </div>
              </Row>
              <Row label={t("settings.account")} hint={t("settings.accountHint")}>
                <button className="btn btn-plain" onClick={() => void logout()}>
                  {t("settings.signOut")}
                </button>
              </Row>
            </div>
          </Section>
        </div>
      </main>

      {dirty && (
        <div className="save-bar" role="region" aria-label={t("settings.dirty")}>
          <span>{t("settings.dirty")}</span>
          <button
            type="button"
            className="btn btn-plain"
            disabled={saving}
            onClick={() => config && setValue(toForm(config))}
          >
            {t("settings.discard")}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? t("settings.saving") : t("settings.save")}
          </button>
        </div>
      )}
    </div>
  );
}
