import * as Tooltip from "@radix-ui/react-tooltip";
import type { ReactElement } from "react";

export function Hint({ text, children }: { text: string; children: ReactElement }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="hint" sideOffset={7} collisionPadding={12}>
          {text}
          <Tooltip.Arrow className="hint-arrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
