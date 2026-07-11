/**
 * Admin Panel Controller
 * QQ Farm Automation Bot - 管理面板服务器
 *
 * 提供 Express + Socket.IO 管理面板后端：
 * - 用户认证（登录/注册/密码修改/密码重置）
 * - 卡密管理（创建/查询/续费/领取记录）
 * - 账号管理（增删改查/启动停止/备注）
 * - 农场操作（种植/施肥/铲除/收获）
 * - 好友管理（列表/操作/拉黑）
 * - 商店/图鉴/活动/背包
 * - 系统设置/公告/代理/二维码登录
 * - 实时状态推送（WebSocket）
 */
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const { Server: SocketIOServer } = require("socket.io");
const {
  CONFIG,
  updateRuntimeConfig,
  getRuntimeConfig,
  getDefaultSystemConfig,
} = require("../config/config");
const { getDataFile, getResourcePath } = require("../config/runtime-paths");
const store = require("../models/store");
const { addOrUpdateAccount, deleteAccount } = store;
const { findAccountByRef } = require("../services/account-resolver");
const { createModuleLogger } = require("../services/logger");
const { registerAdminActivityRoutes } = require("./admin-activity-routes");
const {
  registerAdminAccountRuntimeRoutes,
} = require("./admin-account-runtime-routes");
const { registerAdminAccountRoutes } = require("./admin-account-routes");
const { registerAdminAnalyticsRoutes } = require("./admin-analytics-routes");
const { createAdminAccountAccess } = require("./admin-account-access");
const { registerAdminAuthRoutes } = require("./admin-auth-routes");
const { registerAdminBagRoutes } = require("./admin-bag-routes");
const { registerAdminCardRoutes } = require("./admin-card-routes");
const { registerAdminCurrentUserRoutes } = require("./admin-current-user-routes");
const {
  registerAdminFarmOperationRoutes,
} = require("./admin-farm-operation-routes");
const {
  registerAdminFarmResourceRoutes,
} = require("./admin-farm-resource-routes");
const { registerAdminFriendRoutes } = require("./admin-friend-routes");
const { registerAdminIllustratedRoutes } = require("./admin-illustrated-routes");
const { registerAdminLoginLogRoutes } = require("./admin-login-log-routes");
const {
  registerAdminPlantBlacklistRoutes,
} = require("./admin-plant-blacklist-routes");
const { registerAdminProxyRoutes } = require("./admin-proxy-routes");
const { registerAdminPublicInfoRoutes } = require("./admin-public-info-routes");
const { registerAdminQrLoginRoutes } = require("./admin-qr-login-routes");
const { createAdminRouteHelpers } = require("./admin-route-helpers");
const { registerAdminSettingsRoutes } = require("./admin-settings-routes");
const { registerAdminShopRoutes } = require("./admin-shop-routes");
const { createAdminSessionManager } = require("./admin-session-manager");
const { registerAdminSuperAdminRoutes } = require("./admin-super-admin-routes");
const { registerAdminSystemRoutes } = require("./admin-system-routes");
const { registerAdminUserRoutes } = require("./admin-user-routes");
const userStore = require("../models/user-store");

const adminLogger = createModuleLogger("admin");
const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
];
const PUBLIC_API_PATHS = new Set([
  "/login",
  "/qr/create",
  "/qr/check",
  "/proxy",
  "/card-claim/status",
  "/card-claim/claim",
  "/game-version",
  "/public/login-links",
  "/user-count",
  "/super-admin-announcement",
  "/super-admin-announcement/verify",
  "/changelog",
  "/public/renew",
  "/public/reset-password/verify",
  "/public/reset-password/confirm",
  "/health",
]);
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const ONE_MINUTE_MS = 60 * 1000;
const LOG_SNAPSHOT_LIMIT = 100;
const HTTP_REQUEST_TIMEOUT_MS = 120 * 1000;
const HTTP_HEADERS_TIMEOUT_MS = 16 * 1000;
const HTTP_KEEP_ALIVE_TIMEOUT_MS = 5 * 1000;
const HTTP_CONNECTION_IDLE_TIMEOUT_MS = 30 * 1000;
const HTTP_CLOSE_WAIT_SWEEP_MS = 5000;

let app = null;
let server = null;
let provider = null;
let io = null;

function emitRealtimeStatus(accountId, status) {
  if (!io) return;
  accountId = String(accountId || "").trim();
  if (!accountId) return;
  io.to(`account:${  accountId}`).emit("status:update", {
    accountId,
    status,
  });
}

function emitRealtimeLog(logEntry) {
  if (!io) return;
  const safeLogEntry = logEntry && typeof logEntry === "object" ? logEntry : {};
  const accountId = String(safeLogEntry.accountId || "").trim();
  if (!accountId) return;
  io.to(`account:${  accountId}`).emit("log:new", safeLogEntry);
}

function emitRealtimeAccountLog(logEntry) {
  if (!io) return;
  const safeLogEntry = logEntry && typeof logEntry === "object" ? logEntry : {};
  const accountId = String(safeLogEntry.accountId || "").trim();
  if (!accountId) return;
  io.to(`account:${  accountId}`).emit("account-log:new", safeLogEntry);
}

function configureCorsMiddleware(expressApp) {
  expressApp.use((req, res, next) => {
    const allowedOrigins = CONFIG.ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS;
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.header("Access-Control-Allow-Origin", origin);
    } else if (!origin) {
      res.header("Access-Control-Allow-Origin", "*");
    }
    res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS, PUT");
    res.header(
      "Access-Control-Allow-Headers",
      "Content-Type, x-account-id, x-admin-token, x-proxy-api-key, x-proxy-api-url, x-proxy-app-id",
    );
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Access-Control-Max-Age", "86400");
    if (req.method === "OPTIONS") return res.sendStatus(200);
    return next();
  });
}

function configureStaticAssets(expressApp, webDist) {
  if (fs.existsSync(webDist)) {
    expressApp.use(express.static(webDist));
    return;
  }
  adminLogger.warn("web build not found", { webDist });
  expressApp.get("/", (req, res) =>
    res.send("web build not found. Please build the web project."),
  );
}

function registerAuthGate(expressApp, requireAdminToken) {
  expressApp.use("/api", (req, res, next) => {
    if (PUBLIC_API_PATHS.has(req.path)) return next();
    return requireAdminToken(req, res, next);
  });
}

function registerLogoutRoute(expressApp, invalidateAdminSessionAndDisconnect) {
  expressApp.post("/api/logout", (req, res) => {
    const token = req.adminToken;
    if (token) invalidateAdminSessionAndDisconnect(token);
    res.json({ ok: true });
  });
}

function registerHealthRoute(expressApp) {
  expressApp.get("/api/health", (req, res) => {
    res.json({
      ok: true,
      status: "ok",
      uptime: process.uptime(),
      timestamp: Date.now(),
    });
  });
}

function registerRequestTimeoutGuard(expressApp) {
  expressApp.use((req, res, next) => {
    if (req.path === "/api/health") return next();

    const timeout = setTimeout(() => {
      if (res.headersSent || res.writableEnded || res.destroyed) return;
      res.locals.requestTimedOut = true;
      res.status(503).json({
        ok: false,
        error: "Request Timeout",
      });
    }, HTTP_REQUEST_TIMEOUT_MS);

    res.on("finish", () => clearTimeout(timeout));
    res.on("close", () => clearTimeout(timeout));
    return next();
  });
}

function registerSpaFallback(expressApp, webDist) {
  expressApp.get("*", (req, res) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/game-config")) {
      return res.status(404).json({
        ok: false,
        error: "Not Found",
      });
    }
    if (fs.existsSync(webDist)) {
      return res.sendFile(path.join(webDist, "index.html"));
    }
    return res
      .status(404)
      .send("web build not found. Please build the web project.");
  });
}

function configureHttpServerTimeouts(httpServer) {
  httpServer.requestTimeout = HTTP_REQUEST_TIMEOUT_MS;
  httpServer.headersTimeout = HTTP_HEADERS_TIMEOUT_MS;
  httpServer.keepAliveTimeout = HTTP_KEEP_ALIVE_TIMEOUT_MS;
  httpServer.timeout = HTTP_CONNECTION_IDLE_TIMEOUT_MS;
  httpServer.setTimeout(HTTP_CONNECTION_IDLE_TIMEOUT_MS, (socket) => {
    socket.destroy();
  });
}

function trackHttpConnections(httpServer) {
  const sockets = new Set();
  const sweepTimer = setInterval(() => {
    for (const socket of sockets) {
      if (socket.destroyed) {
        sockets.delete(socket);
        continue;
      }
      if (socket.readableEnded || socket.writableEnded) {
        socket.destroy();
        sockets.delete(socket);
      }
    }
  }, HTTP_CLOSE_WAIT_SWEEP_MS);
  if (typeof sweepTimer.unref === "function") sweepTimer.unref();

  httpServer.on("connection", (socket) => {
    sockets.add(socket);
    socket.setNoDelay(true);
    socket.setKeepAlive(false);
    socket.setTimeout(HTTP_CONNECTION_IDLE_TIMEOUT_MS);
    socket.on("end", () => {
      socket.destroy();
      sockets.delete(socket);
    });
    socket.on("timeout", () => socket.destroy());
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => sockets.delete(socket));
  });
  httpServer.on("close", () => {
    clearInterval(sweepTimer);
    for (const socket of sockets) {
      socket.destroy();
    }
    sockets.clear();
  });
}

function leaveAccountRooms(socket) {
  for (const room of socket.rooms) {
    if (room.startsWith("account:")) socket.leave(room);
  }
}

function hasElevatedAdminRole(session) {
  return session.role === "admin" || session.role === "super_admin";
}

function getSocketHandshakeToken(socket) {
  const authToken =
    socket.handshake.auth && socket.handshake.auth.token
      ? String(socket.handshake.auth.token)
      : "";
  const headerToken =
    socket.handshake.headers && socket.handshake.headers["x-admin-token"]
      ? String(socket.handshake.headers["x-admin-token"])
      : "";
  return authToken || headerToken;
}

function startAdminServer(dataProvider) {
  if (app) return;
  provider = dataProvider;
  app = express();
  app.set("trust proxy", true);
  app.use(express.json({ limit: "256kb" }));

  const adminSessionManager = createAdminSessionManager({
    logger: adminLogger,
    getIo: () => io,
  });
  const {
    cleanupInvalidAdminSessions,
    createAdminSession,
    getSession: getAdminSession,
    hasToken: hasAdminToken,
    invalidateAdminSessionAndDisconnect,
    invalidateAdminSessions,
    requireAdminToken,
    updateAdminSessions,
  } = adminSessionManager;

  const adminAccountAccess = createAdminAccountAccess({
    store,
    getProvider: () => provider,
  });
  const {
    canAccessAccount,
    getAccessibleAccountIdsForUser,
    getAccessibleAccountIdsFromRequest,
    getAccountIdFromRequest,
    getAccountsForUser,
    resolveAccountReference,
  } = adminAccountAccess;

  const adminRouteHelpers = createAdminRouteHelpers({
    store,
    userStore,
    logger: adminLogger,
    getProvider: () => provider,
  });
  const {
    checkAccountLimit,
    checkAccountLimitInterval,
    getAdminUserMutationError,
    requireAdminRole,
    requireDangerConfirmation,
    requireSuperAdminRole,
    sendProviderError,
  } = adminRouteHelpers;

  const webDist = path.join(__dirname, "../../../web/dist");
  configureCorsMiddleware(app);
  configureStaticAssets(app, webDist);
  app.use("/game-config", express.static(getResourcePath("gameConfig")));
  const loginAssetsDir = getDataFile("login-assets");
  fs.mkdirSync(loginAssetsDir, { recursive: true });
  app.use(
    "/login-assets",
    express.static(loginAssetsDir, {
      dotfiles: "deny",
      setHeaders(res, filePath) {
        res.setHeader("X-Content-Type-Options", "nosniff");
        if (path.extname(filePath).toLowerCase() === ".svg") {
          res.setHeader(
            "Content-Security-Policy",
            "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:",
          );
        }
      },
    }),
  );
  app.use("/login-assets", (req, res) => res.sendStatus(404));
  setInterval(cleanupInvalidAdminSessions, FIVE_MINUTES_MS);
  setInterval(checkAccountLimitInterval, ONE_MINUTE_MS);

  registerAdminAuthRoutes({
    app,
    logger: adminLogger,
    userStore,
    requireAdminToken,
    createAdminSession,
    updateAdminSessions,
  });
  registerHealthRoute(app);
  registerAuthGate(app, requireAdminToken);
  registerRequestTimeoutGuard(app);
  registerAdminPublicInfoRoutes({
    app,
    provider,
    store,
    userStore,
    getAccountIdFromRequest,
    canAccessAccount,
    sendProviderError,
  });
  registerLogoutRoute(app, invalidateAdminSessionAndDisconnect);

  registerAdminFarmResourceRoutes({
    app,
    provider,
    getAccountIdFromRequest,
    canAccessAccount,
    sendProviderError,
  });
  registerAdminFriendRoutes({
    app,
    provider,
    store,
    getAccountIdFromRequest,
    canAccessAccount,
    sendProviderError,
  });
  registerAdminPlantBlacklistRoutes({
    app,
    provider,
    store,
    requireAdminToken,
    getAccountIdFromRequest,
    canAccessAccount,
    sendProviderError,
  });
  registerAdminShopRoutes({
    app,
    provider,
    adminLogger,
    getAccountIdFromRequest,
    canAccessAccount,
    sendProviderError,
  });
  registerAdminActivityRoutes({
    app,
    provider,
    getAccountIdFromRequest,
    canAccessAccount,
    sendProviderError,
  });
  registerAdminIllustratedRoutes({
    app,
    provider,
    adminLogger,
    getAccountIdFromRequest,
    canAccessAccount,
    sendProviderError,
  });
  registerAdminBagRoutes({
    app,
    provider,
    emitRealtimeLog,
    getAccountIdFromRequest,
    canAccessAccount,
    sendProviderError,
  });
  registerAdminAccountRuntimeRoutes({
    app,
    provider,
    resolveAccountReference,
    canAccessAccount,
  });
  registerAdminFarmOperationRoutes({
    app,
    provider,
    getAccountIdFromRequest,
    canAccessAccount,
    sendProviderError,
  });
  registerAdminAnalyticsRoutes({ app });
  registerAdminSettingsRoutes({
    app,
    provider,
    store,
    logger: adminLogger,
    getAccountIdFromRequest,
    canAccessAccount,
    requireDangerConfirmation,
  });
  registerAdminSuperAdminRoutes({
    app,
    store,
    userStore,
    logger: adminLogger,
    requireAdminToken,
    requireSuperAdminRole,
    requireDangerConfirmation,
    checkAccountLimit,
  });
  registerAdminSystemRoutes({
    app,
    store,
    logger: adminLogger,
    requireAdminToken,
    requireAdminRole,
    requireSuperAdminRole,
    requireDangerConfirmation,
    getDefaultSystemConfig,
    getRuntimeConfig,
    updateRuntimeConfig,
  });
  registerAdminCardRoutes({
    app,
    requireAdminToken,
    requireAdminRole,
    requireDangerConfirmation,
    userStore,
    adminLogger,
  });
  registerAdminUserRoutes({
    app,
    requireAdminToken,
    requireAdminRole,
    requireSuperAdminRole,
    requireDangerConfirmation,
    getAdminUserMutationError,
    userStore,
    adminLogger,
    invalidateAdminSessions,
    updateAdminSessions,
  });
  registerAdminCurrentUserRoutes({
    app,
    requireAdminToken,
    requireAdminRole,
    userStore,
    store,
  });
  registerAdminAccountRoutes({
    app,
    provider,
    getIo: () => io,
    addOrUpdateAccount,
    deleteAccount,
    findAccountByRef,
    getAccountsForUser,
    getAccountIdFromRequest,
    resolveAccountReference,
    canAccessAccount,
    getAccessibleAccountIdsFromRequest,
    userStore,
    sendProviderError,
  });
  registerAdminQrLoginRoutes({ app });
  registerAdminProxyRoutes({ app, logger: adminLogger });
  registerAdminLoginLogRoutes({
    app,
    userStore,
    logger: adminLogger,
    requireAdminToken,
    requireAdminRole,
    requireDangerConfirmation,
  });
  registerSpaFallback(app, webDist);

  const subscribeSocketToAccount = (socket, accountRef = "") => {
    const rawAccountRef = String(accountRef || "").trim();
    const accountId =
      rawAccountRef && rawAccountRef !== "all"
        ? resolveAccountReference(rawAccountRef)
        : "";
    const token = socket.data.adminToken;
    const session = token ? getAdminSession(token) : null;

    if (accountId && session && !hasElevatedAdminRole(session)) {
      const accounts = getAccountsForUser();
      const account = accounts.find((item) => item.id === accountId);
      if (!account || account.username !== session.username) {
        socket.emit("subscribed", {
          accountId: "all",
          error: "无权访问此账号",
        });
        leaveAccountRooms(socket);
        socket.join("account:all");
        socket.data.accountId = "";
        return;
      }
    }

    leaveAccountRooms(socket);
    if (accountId) {
      socket.join(`account:${  accountId}`);
      socket.data.accountId = accountId;
    } else {
      socket.join("account:all");
      socket.data.accountId = "";
    }
    socket.emit("subscribed", {
      accountId: socket.data.accountId || "all",
    });

    try {
      const subscribedAccountId = socket.data.accountId || "";
      const socketUser = socket.data.user;
      if (
        subscribedAccountId &&
        provider &&
        typeof provider.getStatus === "function"
      ) {
        const status = provider.getStatus(subscribedAccountId);
        socket.emit("status:update", {
          accountId: subscribedAccountId,
          status,
        });
      }
      if (provider && typeof provider.getLogs === "function") {
        let logs = provider.getLogs(subscribedAccountId, {
          limit: LOG_SNAPSHOT_LIMIT,
        });
        if (!Array.isArray(logs)) logs = [];
        if (socketUser) {
          const accessibleAccountIds = getAccessibleAccountIdsForUser(socketUser);
          logs = logs.filter((logEntry) => {
            const logAccountId = logEntry.accountId || logEntry.id;
            if (!logAccountId) return true;
            return accessibleAccountIds.includes(logAccountId);
          });
        }
        socket.emit("logs:snapshot", {
          accountId: subscribedAccountId || "all",
          logs,
        });
      }
      if (provider && typeof provider.getAccountLogs === "function") {
        let accountLogs = provider.getAccountLogs(LOG_SNAPSHOT_LIMIT);
        if (!Array.isArray(accountLogs)) accountLogs = [];
        if (subscribedAccountId) {
          accountLogs = accountLogs.filter((logEntry) => {
            const logAccountId = String(logEntry.accountId || logEntry.id || "");
            return logAccountId === subscribedAccountId;
          });
        }
        if (socketUser) {
          const accessibleAccountIds = getAccessibleAccountIdsForUser(socketUser);
          accountLogs = accountLogs.filter((logEntry) => {
            const logAccountId = logEntry.accountId || logEntry.id;
            return accessibleAccountIds.includes(logAccountId);
          });
        }
        socket.emit("account-logs:snapshot", {
          logs: accountLogs,
        });
      }
    } catch {}
  };

  const adminPort = CONFIG.adminPort || 3007;
  server = app.listen(adminPort, "0.0.0.0", () => {
    adminLogger.info("admin panel started", {
      url: `http://localhost:${  adminPort}`,
      port: adminPort,
    });
  });
  configureHttpServerTimeouts(server);
  trackHttpConnections(server);

  io = new SocketIOServer(server, {
    path: "/socket.io",
    transports: ["websocket", "polling"],
    pingInterval: 20000,
    pingTimeout: 10000,
    connectTimeout: 10000,
    maxHttpBufferSize: 256 * 1024,
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
      allowedHeaders: ["x-admin-token", "x-account-id"],
    },
  });
  io.use((socket, next) => {
    const token = getSocketHandshakeToken(socket);
    if (!token || !hasAdminToken(token)) {
      return next(new Error("Unauthorized"));
    }
    socket.data.adminToken = token;
    socket.data.user = getAdminSession(token);
    return next();
  });
  io.on("connection", (socket) => {
    const initialAccountId =
      (socket.handshake.auth && socket.handshake.auth.accountId) ||
      (socket.handshake.query && socket.handshake.query.accountId) ||
      "";
    subscribeSocketToAccount(socket, initialAccountId);
    socket.emit("ready", { ok: true, ts: Date.now() });
    socket.on("subscribe", (payload) => {
      const safePayload = payload && typeof payload === "object" ? payload : {};
      subscribeSocketToAccount(socket, safePayload.accountId || "");
    });
  });
}

module.exports = {
  startAdminServer,
  emitRealtimeStatus,
  emitRealtimeLog,
  emitRealtimeAccountLog,
};
