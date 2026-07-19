#!/bin/sh
# 单镜像启动脚本（由 tini 托管）：
#   1. 后台启动应用宝 Go 服务（yyb-go），监听容器内端口（默认 8450）
#   2. 前台启动 Node 主服务（client.js），对外暴露 3007
# 这样 yyb-go 与 Node 共用同一个容器、共用 3007 出口（Node 代理多路复用）。

set -e

YYB_HOST="${YYB_HOST:-127.0.0.1}"
YYB_PORT="${YYB_PORT:-8450}"
YYB_RESOURCE_ROOT="${YYB_RESOURCE_ROOT:-/usr/local/share/yyb-go/resource}"

# 后台启动应用宝 Go 服务
yyb-go \
  -host "${YYB_HOST}" \
  -port "${YYB_PORT}" \
  -resource-root "${YYB_RESOURCE_ROOT}" &

# 前台启动 Node 主服务（exec 替换当前 shell，接收 tini 转发的退出信号）
exec node client.js
