import { Icon } from "../icons/Icon";
import { PaneHead } from "../shell/heads";
import { useShell } from "../shell/layout";
import { useThread } from "../thread/store";
import { sections, useSettingsNav } from "./sections";

// 设置应用的列表栏：分区导航，点击滚动到对应分区。
export function SettingsPane() {
  const active = useSettingsNav((state) => state.active);
  const closeDrawer = useShell((state) => state.closeDrawer);
  const version = useThread((state) => state.status?.version);
  return (
    <>
      <PaneHead title="设置" />
      <nav className="pane-scroll" aria-label="设置分区">
        {sections.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            className={`row${active === section.id ? " on" : ""}`}
            aria-current={active === section.id ? "true" : undefined}
            onClick={(event) => {
              event.preventDefault();
              closeDrawer();
              useSettingsNav.setState({ active: section.id });
              document
                .getElementById(section.id)
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          >
            <Icon name={section.icon} size={16} />
            {section.name}
          </a>
        ))}
      </nav>
      {version && <div className="pane-foot">agent v{version}</div>}
    </>
  );
}
