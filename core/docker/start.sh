#!/bin/sh
# 单镜像启动脚本（由 tini 托管）：
#   1. 后台启动应用宝 Go 服务（yyb-go），监听容器内端口（默认 8450）
#   2. 前台启动 Node 主服务（client.js），对外暴露 3007
# 这样 yyb-go 与 Node 共用同一个容器、共用 3007 出口（Node 代理多路复用）。

set -e

YYB_HOST="${YYB_HOST:-127.0.0.1}"
YYB_PORT="${YYB_PORT:-8450}"
YYB_RESOURCE_ROOT="${YYB_RESOURCE_ROOT:-/usr/local/share/yyb-go/resource}"
# token 持久化文件（落在 qq-farm-data 卷，跨容器重建保留）
YYB_TOKEN_FILE="${YYB_TOKEN_FILE:-/app/core/data/yyb_token}"

# ============ 自动生成应用宝 API Token ============
# 单镜像部署时，docker-compose 默认不注入 YYB_API_TOKEN，导致 yyb-go 的
# Bearer 鉴权永远 401、应用宝功能开箱即废。这里在容器启动期自动补齐：
#   1) 已持久化（上次生成过）→ 直接复用，保证重启后 token 不变
#   2) 用户显式传入 YYB_API_TOKEN → 尊重用户设置
#   3) 否则随机生成一个并落盘
# 同一个 token 同时注入给 yyb-go（自身鉴权）与 Node 代理（转发时携带的 apiKey），
# 使应用宝开箱即用，且前端“应用宝”配置可由后端自动预填。
if [ -s "$YYB_TOKEN_FILE" ]; then
  YYB_API_TOKEN="$(cat "$YYB_TOKEN_FILE")"
elif [ -z "${YYB_API_TOKEN:-}" ]; then
  YYB_API_TOKEN="$(cat /proc/sys/kernel/random/uuid | tr -d '-')"
  mkdir -p "$(dirname "$YYB_TOKEN_FILE")"
  printf '%s' "$YYB_API_TOKEN" > "$YYB_TOKEN_FILE"
  chmod 600 "$YYB_TOKEN_FILE"
fi
export YYB_API_TOKEN
export YYB_API_KEY="$YYB_API_TOKEN"

# 后台启动应用宝 Go 服务
yyb-go \
  -host "${YYB_HOST}" \
  -port "${YYB_PORT}" \
  -resource-root "${YYB_RESOURCE_ROOT}" &

# 前台启动 Node 主服务（exec 替换当前 shell，接收 tini 转发的退出信号）
exec node client.js
