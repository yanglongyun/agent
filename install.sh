#!/bin/sh
set -eu
REPO="${AGENT_REPO:-yanglongyun/AGENT}"
VERSION="${AGENT_VERSION:-latest}"
if [ "$(id -u)" = 0 ]; then
  default_bin_dir=/usr/local/bin
  default_install_dir=/usr/local/lib/agentic
else
  default_bin_dir="$HOME/.local/bin"
  default_install_dir="$HOME/.local/share/agentic-install"
fi
BIN_DIR="${AGENT_BIN_DIR:-$default_bin_dir}"
INSTALL_DIR="${AGENT_INSTALL_DIR:-$default_install_dir}"
for tool in curl tar; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "缺少 $tool" >&2
    exit 1
  fi
done
case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  *)
    echo "Windows 请使用 install.ps1" >&2
    exit 1
    ;;
esac
case "$(uname -m)" in
  x86_64|amd64) arch=amd64 ;;
  arm64|aarch64) arch=arm64 ;;
  *)
    echo "不支持的 CPU 架构" >&2
    exit 1
    ;;
esac
if [ "$VERSION" = latest ]; then
  base="https://github.com/$REPO/releases/latest/download"
else
  VERSION=${VERSION#v}
  base="https://github.com/$REPO/releases/download/v$VERSION"
fi
# Also supports a private mirror or a local release server for deployment tests.
base="${AGENT_RELEASE_BASE_URL:-$base}"
archive="agent_${os}_${arch}.tar.gz"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
trap 'exit 1' INT TERM
curl -fL "$base/$archive" -o "$tmp/$archive"
curl -fL "$base/$archive.sha256" -o "$tmp/checksum"
expected=$(awk 'NR==1 {print $1}' "$tmp/checksum")
case "$expected" in
  ''|*[!a-fA-F0-9]*)
    echo "校验文件无效" >&2
    exit 1
    ;;
esac
if [ "${#expected}" -ne 64 ]; then
  echo "校验文件无效" >&2
  exit 1
fi
if command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum "$tmp/$archive" | awk '{print $1}')
elif command -v shasum >/dev/null 2>&1; then
  actual=$(shasum -a 256 "$tmp/$archive" | awk '{print $1}')
else
  echo "缺少 sha256sum 或 shasum" >&2
  exit 1
fi
if [ "$actual" != "$expected" ]; then
  echo "下载文件 SHA-256 校验失败" >&2
  exit 1
fi
tar -xzf "$tmp/$archive" -C "$tmp"
if [ ! -f "$tmp/agentic/server/scripts/cli.js" ] || [ ! -x "$tmp/agentic/runtime/bin/node" ]; then
  echo "发布包缺少 server/scripts/cli.js 或 Node.js" >&2
  exit 1
fi
# Verify the bundled runtime actually runs on this server before changing the launcher.
"$tmp/agentic/runtime/bin/node" "$tmp/agentic/server/scripts/cli.js" version
mkdir -p "$INSTALL_DIR/releases" "$BIN_DIR"
INSTALL_DIR=$(CDPATH= cd -- "$INSTALL_DIR" && pwd)
BIN_DIR=$(CDPATH= cd -- "$BIN_DIR" && pwd)
release_dir="$INSTALL_DIR/releases/$actual"
if [ ! -d "$release_dir" ]; then
  stage=$(mktemp -d "$INSTALL_DIR/releases/.install-XXXXXX")
  cp -R "$tmp/agentic/." "$stage/"
  mv "$stage" "$release_dir"
fi
# A small wrapper points at an immutable release; running old processes keep their files.
quoted=$(printf '%s' "$release_dir/agent" | sed "s/'/'\\\\''/g")
printf '#!/bin/sh\nexec '\''%s'\'' "$@"\n' "$quoted" > "$tmp/launcher"
install -m 0755 "$tmp/launcher" "$BIN_DIR/.agent-new"
mv -f "$BIN_DIR/.agent-new" "$BIN_DIR/agent"
echo "已安装：$BIN_DIR/agent（自带 Node.js，无需 npm）"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    printf '将 %s 加入 PATH，或使用完整路径运行。\n' "$BIN_DIR"
    ;;
esac
if [ "$os" = linux ] && command -v systemctl >/dev/null 2>&1 && [ -z "${AGENT_NO_SERVICE:-}" ]; then
  if [ -n "${AGENT_LISTEN:-}" ]; then
    "$BIN_DIR/agent" install --listen "$AGENT_LISTEN"
  else
    "$BIN_DIR/agent" install
  fi
else
  echo "下一步：$BIN_DIR/agent serve"
fi
