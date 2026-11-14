import { Icon, type IconName } from "../icons/Icon";
import { seedDraft } from "./draft";

/** 空白对话的起手式:每一条都是这个 Agent 真做得到的事。点了填进输入框,不直接发。 */
const STARTERS: Array<{
  icon: IconName;
  label: string;
  text: string;
}> = [
  {
    icon: "folder",
    label: "梳理项目",
    text: "看一下当前目录的结构,总结每个目录是干什么的",
  },
  {
    icon: "terminal",
    label: "检查环境",
    text: "检查这台机器的负载、内存和磁盘使用情况,有问题告诉我",
  },
  {
    icon: "doc",
    label: "整理日志",
    text: "把最近一天系统日志里的错误整理出来",
  },
];

export function Starters() {
  return (
    <div className="starters float-in">
      {STARTERS.map((starter) => (
        <button
          key={starter.text}
          type="button"
          className="starter"
          onClick={() => seedDraft(starter.text)}
        >
          <span className="starter-icon">
            <Icon name={starter.icon} size={16} />
          </span>
          <span className="starter-label">{starter.label}</span>
          <span className="starter-text">{starter.text}</span>
        </button>
      ))}
    </div>
  );
}
