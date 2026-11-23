import type { ReactNode } from "react";

export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="set-section">
      <div className="set-section-head">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
export function Row({
  label,
  hint,
  children,
  keep = false,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
  keep?: boolean;
}) {
  return (
    <div className={`set-row${keep ? " set-row-inline" : ""}`}>
      <div className="set-label">
        <strong>{label}</strong>
        {hint && <span>{hint}</span>}
      </div>
      {children && <div className="set-control">{children}</div>}
    </div>
  );
}
