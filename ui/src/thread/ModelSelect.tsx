import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { useNavigate } from "react-router";
import { Icon } from "../icons/Icon";
import { protocolNames } from "../lib/models";
import { selectedModel, selectModel, useThread } from "./store";

export function ModelSelect() {
  const state = useThread();
  const model = selectedModel(state);
  const navigate = useNavigate();
  return (
    <Dropdown.Root>
      <Dropdown.Trigger
        className="topbar-sub model-trigger"
        aria-label="选择模型"
        disabled={state.busy}
        onClick={(event) => event.stopPropagation()}
      >
        <span className="clip">{model?.name || "选择模型"}</span>
        <Icon name="chevronDown" size={13} />
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          className="dropdown-content model-options"
          align="start"
          side="bottom"
          sideOffset={8}
          collisionPadding={12}
        >
          <Dropdown.Label className="model-options-label">模型</Dropdown.Label>
          <Dropdown.RadioGroup value={model?.id || ""} onValueChange={(id) => selectModel(id)}>
            {state.status?.models.map((item) => (
              <Dropdown.RadioItem
                className="dropdown-item model-option"
                key={item.id}
                value={item.id}
              >
                <div>
                  <span>{item.name}</span>
                  <small>
                    {item.model} · {protocolNames[item.protocol]}
                  </small>
                </div>
                <Dropdown.ItemIndicator>
                  <Icon name="check" size={15} />
                </Dropdown.ItemIndicator>
              </Dropdown.RadioItem>
            ))}
          </Dropdown.RadioGroup>
          <Dropdown.Separator className="dropdown-separator" />
          <Dropdown.Item className="dropdown-item" onSelect={() => navigate("/settings")}>
            <Icon name="settings" size={15} />
            管理模型
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
