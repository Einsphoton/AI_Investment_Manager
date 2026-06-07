#!/usr/bin/env bash
# 推送到 GitHub: git@github.com:Einsphoton/AI_Investment_Manager.git
# 假设 remote `origin` 已配置；如未配置，请先手动配置 SSH/HTTPS 凭据

set -euo pipefail

cd "$(dirname "$0")"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
REMOTE="origin"

echo "==> 推送 ${BRANCH} → ${REMOTE}"
git push "${REMOTE}" "${BRANCH}"

echo
echo "==> 推送完成。当前最新 commit："
git log -1 --stat
