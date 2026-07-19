# QQ Farm Bot Private

> 私有维护仓库。此仓库用于 QQ 农场多账号挂机工具的重构版源码维护，不包含运行时账号数据、用户数据和日志。

## 简介

这是一个基于 Node.js 的 QQ 农场自动化工具，提供多账号管理、Web 控制面板、实时日志、数据统计、好友管理、活动、商城、图鉴和后台管理等功能。

当前仓库定位为 `2.3.x` 重构维护版，重点是整理前后端结构、降低维护成本，并保留已有核心功能。

> **派生说明**：本仓库是在 [cwser/qq-farm-bot-private](https://github.com/cwser/qq-farm-bot-private) 基础上进行的**二次修改（二改）**维护分支，在其版本之上增加了多账号 Worker 模型、Vue 3 控制面板重构、ACE 安全链路等内容。更早的上游原始项目见下方「特别感谢」。

维护信息：

- 仓库：`Aoluis1005/qq-farm-bot`
- 维护分支：`main`
- 完整更新日志参考：[QQ 农场更新日志](https://github.com/Aoluis1005/qq-farm-bot/blob/main/UPDATE_README.md)

> **注意**：本仓库为基于 [cwser/qq-farm-bot-private](https://github.com/cwser/qq-farm-bot-private) 的二改维护分支（原作者/上游信息见「特别感谢」）。以下所有功能与配置均以本仓库为准。

## 当前状态

- 后端：Node.js / CommonJS / Express / Socket.IO
- 前端：Vue 3 / Vite / TypeScript / Pinia / UnoCSS
- 包管理：pnpm workspace
- 部署：源码运行、Docker、二进制打包
- 默认面板端口：`3007`
- 默认管理员账号：`admin`
- 默认管理员密码：`admin`

部署后请立即修改默认密码。

## 技术栈

**后端**

[<img src="https://skillicons.dev/icons?i=nodejs" height="48" title="Node.js 20+" />](https://nodejs.org/)
[<img src="https://skillicons.dev/icons?i=express" height="48" title="Express 4" />](https://expressjs.com/)
[<img src="https://skillicons.dev/icons?i=socketio" height="48" title="Socket.IO 4" />](https://socket.io/)

**前端**

[<img src="https://skillicons.dev/icons?i=vue" height="48" title="Vue 3" />](https://vuejs.org/)
[<img src="https://skillicons.dev/icons?i=vite" height="48" title="Vite 7" />](https://vitejs.dev/)
[<img src="https://skillicons.dev/icons?i=ts" height="48" title="TypeScript 5" />](https://www.typescriptlang.org/)
[<img src="https://cdn.simpleicons.org/pinia/FFD859" height="48" title="Pinia 3" />](https://pinia.vuejs.org/)
[<img src="https://skillicons.dev/icons?i=unocss" height="48" title="UnoCSS" />](https://unocss.dev/)

**部署**

[<img src="https://skillicons.dev/icons?i=pnpm" height="48" title="pnpm 10" />](https://pnpm.io/)
[<img src="https://skillicons.dev/icons?i=docker" height="48" title="Docker" />](https://www.docker.com/)

## 环境要求

- Node.js 20+
- pnpm，推荐通过 `corepack enable` 启用
- Docker，可选，仅 Docker 部署时需要

## 快速启动

```powershell
git clone https://github.com/Aoluis1005/qq-farm-bot.git
cd qq-farm-bot

corepack enable
pnpm install
pnpm build:web
pnpm dev:core
```

启动后访问：

- 本机：`http://localhost:3007`
- 局域网：`http://<你的IP>:3007`

如需修改端口：

```powershell
$env:ADMIN_PORT="你的新端口"
pnpm dev:core
```

## Docker 部署

> **应用宝（yyb-go）已内置**：自本版本起，官方 `docker compose up -d --build` 构建的镜像**已包含应用宝 Go 服务（yyb-go）**，与 Node 主服务运行在**同一容器、共用 3007 端口**。Node 会把 `/api/yyb/*` 自动代理到容器内 yyb-go，你**无需再单独部署或填写应用宝接口地址**。只需在 `docker-compose.yml` 中设置 `YYB_API_TOKEN`（它同时作为 yyb-go 的 Bearer 鉴权与 Node 代理转发用的 Token）即可。
>
> **注意**：二进制发布版（exe）与纯源码运行**不包含** yyb-go，仍需自行部署该 Go 服务并填写接口地址。

```bash
git clone https://github.com/Aoluis1005/qq-farm-bot.git
cd qq-farm-bot

docker compose up -d --build
docker compose logs -f
```

停止并移除容器：

```bash
docker compose down
```

Docker 部署修改版本号或配置后，建议重新构建容器：

```bash
docker compose down
docker compose up -d --build
```

## 二进制发布版

构建：

```bash
pnpm install
pnpm package:release
```

产物输出在 `dist/` 目录。

| 平台 | 文件名 |
| --- | --- |
| Windows x64 | `qq-farm-bot.exe` |
| Linux x64 | `qq-farm-bot` |
| macOS Intel | `qq-farm-bot-x64` |
| macOS Apple Silicon | `qq-farm-bot-arm64` |

运行：

```bash
# Windows：双击 exe 或在终端执行
.\qq-farm-bot-win-x64.exe

# Linux / macOS
chmod +x ./qq-farm-bot
./qq-farm-bot
```

程序会在可执行文件同级目录自动创建 `data/`，用于保存账号、用户、日志和缓存等运行时数据。

## 登录与安全

- 面板首次访问需要登录
- 默认管理员账号：`admin`
- 默认管理员密码：`admin`
- 部署后请立即修改默认密码
- 不要把运行时数据、账号文件、日志或 `.env` 文件提交到仓库

## 应用宝接口配置（重要）

应用宝登录 / 离线重连依赖一个**应用宝接口服务**（提供 `wxapp/getCode` 等能力）。添加账号时填写的「接口地址」和「API Token」**必须换成你自己的**：

- **接口地址**：**不预填**，请填写你自己部署的接口服务地址（格式如 `http://你的服务器:端口/wxapp/getCode`）。
- **API Token**：**不预填**，需要你自行申请/填写自己的 Token，不要使用他人或示例值。
- 离线自动重连、扫码登录等能力均依赖该接口可用；接口不可用或 Token 失效时需重新填写。
- 添加账号弹窗中，应用宝相关有两个并列标签页：「应用宝」（填写接口地址/Token、选择已有账号登录、配置离线重连）与「应用宝扫码」（扫码添加新账号）。两者共用同一份接口配置，先填好「应用宝」再切到「应用宝扫码」即可。

> **Docker 部署用户**：无需自备应用宝接口服务——镜像已内置 yyb-go（见上方「Docker 部署」说明），设置 `YYB_API_TOKEN` 即可直接使用应用宝登录。
> **非 Docker 部署用户**（二进制 / 源码运行）：如果你没有自己的应用宝接口服务，应用宝登录功能将无法使用，可改用其他登录方式。

## 数据与隐私

以下内容已通过 `.gitignore` 排除，不应提交到仓库：

- `core/data/`
- `node_modules/`
- `web/dist/`
- `.env`
- `.env.*`
- `*.log`
- `logs/`
- `tmp/`

`core/data/` 会在运行时自动生成，可能包含账号、用户、登录日志、好友缓存、统计数据和其他敏感信息。备份或迁移服务器时可以单独处理该目录，但不要提交到 GitHub。

## 项目结构

```text
qq-farm-bot-private/
├── core/                  # 后端（Node.js 机器人引擎）
│   ├── src/
│   │   ├── config/        # 配置管理
│   │   ├── controllers/   # HTTP API
│   │   ├── gameConfig/    # 游戏静态数据
│   │   ├── models/        # 数据模型与持久化
│   │   ├── proto/         # Protobuf 协议定义
│   │   ├── runtime/       # 运行时引擎与 Worker 管理
│   │   └── services/      # 业务逻辑（农场、好友、任务等）
│   └── client.js          # 后端入口
├── web/                   # 前端（Vue 3 + Vite）
│   ├── src/
│   │   ├── api/           # API 客户端
│   │   ├── components/    # Vue 组件
│   │   ├── stores/        # Pinia 状态管理
│   │   └── views/         # 页面视图
├── docker-compose.yml
├── pnpm-workspace.yaml
└── package.json
```

## 常用命令

```bash
# 安装依赖
pnpm install

# 构建前端
pnpm build:web

# 启动后端和面板
pnpm dev:core

# 前后端检查
pnpm lint

# 打包发布版
pnpm package:release
```

## 维护说明

- 只提交源码、配置、锁文件、静态资源和文档。
- 不提交 `core/data/`、依赖目录、构建产物或本地日志。
- 更新功能前优先确认是可见功能、隐藏功能、内部能力还是休眠能力。
- 前端大页面逐步拆分到 `components/`、`composables/` 和 `stores/`。
- 后端入口只保留 wiring，具体接口逻辑优先下沉到领域路由、helper 或 service。
- 中文显示异常时先确认文件真实 UTF-8 内容，不要只按终端乱码判断。

## 特别感谢

- **本仓库基于 [cwser/qq-farm-bot-private](https://github.com/cwser/qq-farm-bot-private) 二改**（在此版本基础上进行修改，是其下游维护分支）
- 基于 [Penty-d/qq-farm-bot-ui](https://github.com/Penty-d/qq-farm-bot-ui) 二改
- 核心功能：[linguo2625469/qq-farm-bot](https://github.com/linguo2625469/qq-farm-bot)
- 部分功能：[QianChenJun/qq-farm-bot](https://github.com/QianChenJun/qq-farm-bot)
- 扫码登录：[lkeme/QRLib](https://github.com/lkeme/QRLib)
- 推送通知：[imaegoo/pushoo](https://github.com/imaegoo/pushoo)

## 免责声明

本项目仅供学习与研究用途。使用本工具可能违反游戏服务条款，由此产生的一切后果由使用者自行承担。
