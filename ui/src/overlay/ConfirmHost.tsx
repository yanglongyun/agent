import { settleConfirm, useConfirm } from "./confirm";
import { Dialog } from "./Dialog";
import { useT } from "@/i18n";
export function ConfirmHost() {
  const t = useT();
  const state = useConfirm();
  if (!state.open) {
    return null;
  }
  return (
    <Dialog title={state.title} close={() => settleConfirm(false)}>
      <p className="confirm-message">{state.message}</p>
      <div className="modal-foot">
        <button className="btn btn-plain" onClick={() => settleConfirm(false)}>
          {t("common.cancel")}
        </button>
        <button
          className={`btn ${state.danger ? "btn-danger" : "btn-primary"}`}
          onClick={() => settleConfirm(true)}
        >
          {state.confirmText}
        </button>
      </div>
    </Dialog>
  );
}
