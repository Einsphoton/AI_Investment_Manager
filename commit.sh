#!/usr/bin/env bash
# 一键 AI 分析"0 条入库"诊断补丁 - 提交脚本
# 仅暂存本次任务相关的 7 个文件，避开未追踪的旧 dist 产物与未完成改动

set -euo pipefail

cd "$(dirname "$0")"

git add \
  backend/main.py \
  backend/stream_events.py \
  frontend/src/components/AIProgressOverlay.tsx \
  frontend/src/pages/Dashboard.tsx \
  frontend/src/pages/InvestmentAdvice.tsx \
  frontend/src/pages/Targets.tsx \
  frontend/src/stores/AIWorkContext.tsx

git status --short

git commit -m "fix(ai): 暴露一键 AI 分析中 0 条入库的过滤原因

后端
- _normalize_investment_advice 新增 diagnostics 参数，_drop 助手把
  invalid_trade_type / evidence_gate / no_budget / no_price_shares /
  budget_mismatch / no_budget_remaining / amount_too_small /
  insufficient_shares 等丢弃原因分类记录
- stream_investment_advice 把 diagnostics 汇总成 SSE log 事件推给前端，
  并写进 InvestmentAdviceRecord.summary
- ai_analyze_targets 增加 filter_diagnostics
  (raw_count / not_dict_count / missing_code_count /
   filtered_market_count / filtered_type_count / added_count /
   filter_markets / filter_asset_types)，
  暴露在 report.filter_diagnostics
- stream_target_analysis 在 new_count==0 时显式 yield 过滤统计
  与当前 markets/asset_types 限制

前端
- LogEntry.type 增加 'warning'；SSE '⚠️' 日志归类为 warning
- AIProgressOverlay 给 warning 配置琥珀色 + ⚠️ 图标
- Dashboard / Targets / InvestmentAdvice 在 streamSSE 拿到
  result.new_recommendations / result.advice 为空时弹 message.warning
  提示用户打开覆盖层日志或「设置 → AI 推荐」调整过滤范围；
  fallback (非流式) 路径同样检查"

git log -1 --stat
