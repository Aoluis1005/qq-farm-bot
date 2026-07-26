#!/usr/bin/env bash
# qq-farm-bot 一键部署脚本（在服务器上运行）
# 用法： bash server-deploy.sh
set -e
cd "$(dirname "$0")"

echo "==> 当前目录: $(pwd)"

# 若未设置 YYB_API_TOKEN，则生成一个随机 token 写入 .env（同时作为 Go 服务与 Node 代理的鉴权，二者一致）
if [ ! -f .env ]; then
  TOKEN=$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)
  printf 'YYB_API_TOKEN=%s\n' "$TOKEN" > .env
  echo "==> 已生成随机 YYB_API_TOKEN 并写入 .env（请妥善保存，用于应用宝扫码登录鉴权）"
  echo "==> YYB_API_TOKEN=$TOKEN"
else
  echo "==> 已存在 .env，沿用其中的 YYB_API_TOKEN"
fi

echo "==> 构建并启动 (docker compose up -d --build) ..."
docker compose up -d --build

echo "==> 等待服务就绪 (15s) ..."
sleep 15

echo "==> 容器状态:"
docker ps --filter name=qq-farm-bot --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'

echo "==> 健康检查 /api/status:"
curl -s -m 10 http://localhost:3007/api/status || echo "(无法连接，请查看日志)"

echo
echo "==> 部署完成。面板地址: http://<服务器IP>:3007"
echo "==> 用手机微信扫描面板里的应用宝二维码添加主号，然后回来让我触发加好友实测。"
echo "==> 查看日志: docker logs -f qq-farm-bot"
