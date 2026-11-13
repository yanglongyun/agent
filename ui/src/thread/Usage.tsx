import * as Popover from "@radix-ui/react-popover";
import { useEffect, useRef, useState } from "react";
import type { UsageRecord } from "./thread";
import { usageSummary } from "./metering";
import { Icon } from "../icons/Icon";

export function Usage({ records }: { records: UsageRecord[] }) {
  const [open, setOpen] = useState(false);
  const keyboardOpen = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const show = () => {
    cancelClose();
    setOpen(true);
  };
  const scheduleClose = () => {
    if (keyboardOpen.current) {
      return;
    }
    cancelClose();
    closeTimer.current = setTimeout(() => {
      setOpen(false);
    }, 180);
  };
  useEffect(
    () => () => {
      if (closeTimer.current !== null) {
        clearTimeout(closeTimer.current);
      }
    },
    [],
  );
  if (!records.length) {
    return null;
  }
  const summary = usageSummary(records);
  let missing = "未设置价格";
  if (summary.costs.length) {
    missing = "部分费用未计";
  } else if (records.some((record) => !record.metering)) {
    missing = "费用未记录";
  } else if (records.some((record) => record.metering?.status === "invalid_usage")) {
    missing = "用量不完整";
  }
  return (
    <div className="answer-usage">
      <Popover.Root
        open={open}
        onOpenChange={(next) => {
          cancelClose();
          setOpen(next);
        }}
      >
        <Popover.Trigger asChild>
          <button
            type="button"
            className="usage-trigger"
            aria-label="查看用量"
            onMouseEnter={() => {
              keyboardOpen.current = false;
              show();
            }}
            onMouseLeave={scheduleClose}
            onClick={(event) => {
              event.preventDefault();
              keyboardOpen.current = event.detail === 0;
              show();
            }}
          >
            <Icon name="layers" size={12} />
            <span>{summary.tokens.length ? `${summary.tokens.join(" · ")} tokens` : "用量"}</span>
            {records.length > 1 && <span>{records.length} 次请求</span>}
            {summary.costs.map((cost) => (
              <span key={cost}>{cost}</span>
            ))}
            {summary.missing > 0 && <span>{missing}</span>}
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="usage-tooltip"
            side="top"
            align="start"
            sideOffset={10}
            collisionPadding={16}
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
            onFocus={cancelClose}
            onOpenAutoFocus={(event) => {
              if (!keyboardOpen.current) {
                event.preventDefault();
              }
            }}
            onCloseAutoFocus={(event) => {
              if (!keyboardOpen.current) {
                event.preventDefault();
              }
              keyboardOpen.current = false;
            }}
            aria-label="原始用量"
          >
            <div className="usage-tooltip-head">
              <span>原始用量</span>
              <Popover.Close className="icon-btn" aria-label="关闭用量">
                <Icon name="close" size={14} />
              </Popover.Close>
            </div>
            <pre>{JSON.stringify(summary.raw, null, 2)}</pre>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
