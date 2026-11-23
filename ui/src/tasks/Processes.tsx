import { useEffect, useState } from "react";
import { labels, active, statusTone } from "./status";
import { Dialog } from "@/overlay/Dialog";
import { api } from "@/lib/api";
import { useT } from "@/i18n";
import type { ShellJob } from "./activity";

export type { ShellJob };

export function ProcessDetail({
  processId,
  onClose,
  onChanged,
}: {
  processId: string;
  onClose: () => void;
  onChanged: (record: ShellJob) => void;
}) {
  const t = useT();
  const [record, setRecord] = useState<ShellJob | null>(null);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  useEffect(() => {
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const result = await api.get<ShellJob>(`/api/processes/${processId}`);
        if (!current) {
          return;
        }
        setRecord(result);
        setReadError("");
        if (active(result)) {
          timer = setTimeout(() => void load(), 1500);
        }
      } catch (failure) {
        if (current) {
          setReadError(failure instanceof Error ? failure.message : t("processes.loadFailed"));
          timer = setTimeout(() => void load(), 3000);
        }
      }
    }
    void load();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [processId]);
  const running = record && active(record);
  async function act(action: "write" | "close" | "cancel") {
    if (pending) {
      return;
    }
    setPending(true);
    try {
      const updated = await api.post<ShellJob>(`/api/processes/${processId}/stdio`, {
        action,
        ...(action === "write" ? { input: input + "\n" } : {}),
      });
      setRecord(updated);
      onChanged(updated);
      setError("");
      if (action === "write") {
        setInput("");
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("processes.actionFailed"));
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog title={t("processes.detail")} className="modal-xwide" close={onClose}>
      {(readError || error) && <p className="modal-error">{readError || error}</p>}
      {!record && !readError && <p className="note">{t("common.reading")}</p>}
      {record && (
        <>
          <div className="task-brief">
            <pre className="well process-command">{record.command}</pre>
            <div className="pill-row">
              <span className={`badge ${statusTone(record.status)}`}>{labels[record.status]}</span>
              <span className="pill mono">{record.workdir}</span>
              {record.exit_code !== null && (
                <span className="pill">{t("processes.exitCode", { code: record.exit_code })}</span>
              )}
            </div>
          </div>
          {record.error && <p className="modal-error">{record.error}</p>}
          <div className="process-label">
            <span>{t("processes.output")}</span>
            {record.truncated > 0 && <small>{t("processes.truncated")}</small>}
          </div>
          <pre className="well process-output" aria-label={t("processes.output")}>
            {record.output || t("processes.empty")}
          </pre>
          {running && !record.stdin_closed && (
            <form
              className="process-input"
              onSubmit={(event) => {
                event.preventDefault();
                void act("write");
              }}
            >
              <label className="field" htmlFor="process-input">
                {t("processes.sendInput")}
              </label>
              <textarea
                id="process-input"
                className="input mono"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={t("processes.inputPlaceholder")}
                rows={2}
                disabled={pending}
              />
              <div>
                <button
                  type="button"
                  className="btn btn-plain"
                  disabled={pending}
                  onClick={() => void act("close")}
                >
                  {t("processes.endInput")}
                </button>
                <button type="submit" className="btn btn-primary" disabled={pending}>
                  {t("processes.send")}
                </button>
              </div>
            </form>
          )}
          {running && (
            <div className="modal-foot">
              <button
                type="button"
                className="btn btn-danger"
                disabled={pending || record.status === "cancelling"}
                onClick={() => void act("cancel")}
              >
                {t("processes.stop")}
              </button>
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}
