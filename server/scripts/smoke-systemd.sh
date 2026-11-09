#!/bin/sh
# Runs only on a disposable Linux CI runner with sudo and systemd.
set -eu
[ "${CI:-}" = true ] && [ "$(uname -s)" = Linux ] || { echo "此脚本仅供一次性 Linux CI runner 使用" >&2; exit 1; }
smoke_dir=$(mktemp -d)
cleanup() {
  sudo systemctl disable --now agentic >/dev/null 2>&1 || true
  sudo rm -f /etc/systemd/system/agentic.service
  sudo systemctl daemon-reload
  sudo rm -rf "$smoke_dir"
}
trap cleanup EXIT
sudo env AGENT_HOME="$smoke_dir/data" AGENT_BIN_DIR="$smoke_dir/bin" AGENT_INSTALL_DIR="$smoke_dir/program" \
  AGENT_RELEASE_BASE_URL="file://$(pwd)/server/dist" AGENT_LISTEN=127.0.0.1:19528 sh install.sh
for attempt in 1 2 3 4 5; do
  if curl -fsS http://127.0.0.1:19528/healthz; then break; fi
  sleep 1
done
curl -fsS http://127.0.0.1:19528/healthz
sudo systemctl is-enabled agentic
sudo env AGENT_HOME="$smoke_dir/data" "$smoke_dir/bin/agent" restart
sudo env AGENT_HOME="$smoke_dir/data" "$smoke_dir/bin/agent" stop
if sudo systemctl is-active --quiet agentic; then exit 1; fi
sudo env AGENT_HOME="$smoke_dir/data" "$smoke_dir/bin/agent" start
sudo systemctl is-active --quiet agentic
sudo env AGENT_HOME="$smoke_dir/data" "$smoke_dir/bin/agent" uninstall
sudo test -f "$smoke_dir/data/config.json"
echo 'systemd 安装、重启、停止、启动、卸载和数据保留验证通过'
