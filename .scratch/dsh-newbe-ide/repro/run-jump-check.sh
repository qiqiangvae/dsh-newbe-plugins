#!/usr/bin/env bash
# 复现/回归一个命令：驱动真实面板，打印 PASS/FAIL 并以退出码表达。
#   REPRO_TARGET=kun-ai REPRO_MODE=hidden ./.playwright-cli/repro.sh
#   REPRO_TARGET=zagent  REPRO_MODE=visible ./.playwright-cli/repro.sh   # 对照组
set -uo pipefail
cd "$(dirname "$0")/../../.."   # 仓库根
S=repro
TARGET=${REPRO_TARGET:-kun-ai}
MODE=${REPRO_MODE:-hidden}
if ! playwright-cli -s=$S --raw eval "1" >/dev/null 2>&1; then
  T=$(grep "dsh web: http" ~/.dsh/web.log | tail -1 | sed 's/.*token=//')
  playwright-cli -s=$S open "http://127.0.0.1:3080/?token=$T" >/dev/null 2>&1
  sleep 4
fi
playwright-cli -s=$S --raw eval "(() => { window.__reproTarget='$TARGET'; window.__reproMode='$MODE'; return 'set'; })()" >/dev/null 2>&1
out=$(playwright-cli -s=$S --raw run-code --filename=.scratch/dsh-newbe-ide/repro/panel-jump.js 2>&1 \
  | grep -v "Update available\|npm install\|║\|╔\|╚")
echo "$out"
case "$out" in *PASS*) exit 0;; *) exit 1;; esac
