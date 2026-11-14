import * as Tooltip from "@radix-ui/react-tooltip";
import type { ReactElement } from "react";

export function Hint({
  text,
  side = "top",
  children,
}: {
  text: string;
  side?: "top" | "right" | "bottom" | "left";
  children: ReactElement;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="hint" side={side} sideOffset={8} collisionPadding={12}>
          {text}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
