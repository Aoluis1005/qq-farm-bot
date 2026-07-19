# syntax=docker/dockerfile:1

# ===== Node 构建阶段（安装全量依赖 + 构建前端）=====
FROM node:20-alpine AS builder

WORKDIR /app

RUN corepack enable

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY core/package.json ./core/
COPY web/package.json ./web/

RUN pnpm config set registry https://registry.npmmirror.com/ \
    && pnpm install --frozen-lockfile

COPY core ./core
COPY web ./web

RUN pnpm build:web

# ===== 应用宝 Go 服务（yyb-go）编译阶段 =====
FROM golang:1.23-alpine AS yyb-builder

WORKDIR /src

RUN apk add --no-cache git

# yyb-go 为公开仓库，直接克隆即可；如需私有仓库可传入 build-arg GITHUB_TOKEN
ARG GITHUB_TOKEN=
RUN if [ -n "$GITHUB_TOKEN" ]; then \
      git clone --depth 1 https://x-access-token:${GITHUB_TOKEN}@github.com/Aoluis1005/yyb-go.git . ; \
    else \
      git clone --depth 1 https://github.com/Aoluis1005/yyb-go.git . ; \
    fi

# 纯 Go 实现（modernc sqlite，无需 CGO），静态编译；使用国内 goproxy 加速依赖拉取
ENV GOPROXY=https://goproxy.cn,direct
WORKDIR /src/cmd/yyb-go
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /out/yyb-go .

# 复制运行时需要的 resource 目录（avatars/qr/templates）
RUN mkdir -p /out/resource && cp -r /src/resource/. /out/resource/

# ===== 运行阶段 =====
FROM node:20-alpine AS runner

WORKDIR /app/core

ENV NODE_ENV=production
ENV TZ=Asia/Shanghai

RUN apk add --no-cache tzdata tini && \
    cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime && \
    echo "Asia/Shanghai" > /etc/timezone && \
    apk del tzdata

# 直接拷贝 builder 全量（含 node_modules），避免 pnpm symlink / 多阶段覆盖坑
COPY --from=builder /app /app

# 应用宝 Go 服务：二进制 + 运行时资源
COPY --from=yyb-builder /out/yyb-go /usr/local/bin/yyb-go
COPY --from=yyb-builder /out/resource /usr/local/share/yyb-go/resource

RUN mkdir -p /usr/local/share/yyb-go/resource/db /app/core/data/logs && \
    chmod -R 755 /usr/local/share/yyb-go /app/core/data

# 单镜像启动脚本（tini 托管）
COPY --from=builder /app/core/docker/start.sh /usr/local/bin/start.sh
RUN chmod +x /usr/local/bin/start.sh

VOLUME ["/app/core/data"]
VOLUME ["/usr/local/share/yyb-go/resource/db"]

EXPOSE 3007

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD wget -q --spider http://localhost:3007/api/status || exit 1

# tini 作为 PID1 正确转发信号；start.sh 先起 yyb-go（容器内 8450），再起 node（对外 3007）
ENTRYPOINT ["tini", "-s", "--"]
CMD ["/usr/local/bin/start.sh"]
