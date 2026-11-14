import { Outlet, useMatch, useNavigate } from "react-router";
import { Icon } from "../icons/Icon";
import { AppBar } from "../shell/AppBar";
import { OwnerList } from "./OwnerList";
import "./logs.css";

// 日志应用：左边是所有对话和子任务，右边是用量总览或某一项的全部记录。
// 窄屏一次只显示一栏：没选中任何一项时显示列表，选中后显示详情。
export function LogsApp() {
  const detail = useMatch("/logs/:kind/:id");
  const overview = useMatch("/logs/overview");
  const navigate = useNavigate();
  const showMain = Boolean(detail || overview);
  return (
    <section className={`thread logs-app${showMain ? " has-detail" : ""}`}>
      <AppBar
        title="日志"
        leading={
          showMain ? (
            <button
              type="button"
              className="icon-btn logs-back"
              aria-label="返回列表"
              onClick={() => navigate("/logs")}
            >
              <Icon name="back" size={19} />
            </button>
          ) : null
        }
      />
      <div className="logs-layout">
        <OwnerList selectedId={detail?.params.id} overviewSelected={!detail} />
        <main className="logs-main">
          <Outlet />
        </main>
      </div>
    </section>
  );
}
