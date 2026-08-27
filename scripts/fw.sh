#!/usr/bin/env bash
# 韌體建置／上傳的統一入口。
#
# 為什麼需要這支：PlatformIO 常常是透過 VS Code extension 安裝的，執行檔落在
# ~/.platformio/penv/bin/pio 而沒有進 PATH，直接打 `pio` 會 command not found。
# 這裡會依序找 PATH、penv、Library 三個位置。
#
# 用法：
#   scripts/fw.sh build            # 建置預設 env
#   scripts/fw.sh build <env>      # 建置指定 env
#   scripts/fw.sh upload [env]     # 建置並上傳到板子
#   scripts/fw.sh clean [env]
#   scripts/fw.sh envs             # 列出 platformio.ini 裡所有 env
#   scripts/fw.sh monitor          # 看板子的 serial 輸出（等同 app 的 DebugView）
#   scripts/fw.sh monitor <port>   # 指定 port，例如 /dev/cu.usbmodem101
#   scripts/fw.sh ports            # 列出目前可用的 serial port
#
# 注意：serial port 是獨佔的。monitor 開著時，Studio 的 DebugView、燒錄與
# 上傳 config 都會搶不到 port（錯誤訊息是 Cannot lock port）。要用 app 操作
# 前先把 monitor 關掉（Ctrl+C，若無效試 Ctrl+]）。
set -euo pipefail

DEFAULT_ENV="esp32-s3-devkitc-1-n16r8"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

find_pio() {
  if command -v pio >/dev/null 2>&1; then
    command -v pio
    return
  fi
  for candidate in \
    "$HOME/.platformio/penv/bin/pio" \
    "$HOME/Library/Application Support/Code/User/globalStorage/platformio.platformio-ide/penv/bin/pio"
  do
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return
    fi
  done
  echo "找不到 pio 執行檔。請安裝 PlatformIO Core：" >&2
  echo "  python3 -m pip install --user platformio" >&2
  echo "或安裝 VS Code 的 PlatformIO IDE extension。" >&2
  exit 1
}

PIO="$(find_pio)"
ACTION="${1:-build}"
# monitor 的第二個參數是 port 而不是 env
PIO_ENV="${2:-$DEFAULT_ENV}"
PORT="${2:-}"

cd "$REPO_ROOT"

case "$ACTION" in
  build)
    exec "$PIO" run -e "$PIO_ENV"
    ;;
  upload)
    exec "$PIO" run -e "$PIO_ENV" -t upload
    ;;
  clean)
    exec "$PIO" run -e "$PIO_ENV" -t clean
    ;;
  monitor)
    # baud 取自 platformio.ini 的 monitor_speed（115200），不需另外指定
    if [[ -n "$PORT" ]]; then
      exec "$PIO" device monitor -p "$PORT"
    fi
    exec "$PIO" device monitor
    ;;
  ports)
    exec "$PIO" device list
    ;;
  envs)
    grep -oE '^\[env:[^]]+\]' platformio.ini | sed 's/^\[env://; s/\]$//'
    ;;
  *)
    echo "未知動作：$ACTION（可用：build / upload / clean / envs / monitor / ports）" >&2
    exit 1
    ;;
esac
