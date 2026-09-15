#!/usr/bin/env bash
# 复现/回归一个命令：驱动真实面板验「总览卡片删除链路」，打印 PASS/FAIL 并以退出码表达。
#   ./.scratch/dsh-newbe-ide/repro/run-delete-check.sh
set -uo pipefail
cd "$(dirname "$0")/../../.."   # 仓库根
S=repro
if ! playwright-cli -s=$S --raw eval "1" >/dev/null 2>&1; then
  T=$(grep "dsh web: http" ~/.dsh/web.log | tail -1 | sed 's/.*token=//')
  playwright-cli -s=$S open "http://127.0.0.1:3080/?token=$T" >/dev/null 2>&1
  sleep 5
fi
out=$(playwright-cli -s=$S --raw run-code --filename=.scratch/dsh-newbe-ide/repro/panel-delete.js 2>&1 \
  | grep -v "Update available\|npm install\|║\|╔\|╚")
echo "$out"
case "$out" in *PASS*) exit 0;; *) exit 1;; esac
