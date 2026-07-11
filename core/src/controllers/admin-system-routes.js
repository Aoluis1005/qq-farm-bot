const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const multer = require("multer");
const { getDataFile } = require("../config/runtime-paths");

const LOGIN_ASSETS_DIR = getDataFile("login-assets");
const LOGIN_LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGIN_LOGO_EXTENSIONS = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
  ["image/svg+xml", ".svg"],
  ["image/x-icon", ".ico"],
  ["image/vnd.microsoft.icon", ".ico"],
]);

fs.mkdirSync(LOGIN_ASSETS_DIR, { recursive: true });

const loginLogoUpload = multer({
  storage: multer.diskStorage({
    destination: LOGIN_ASSETS_DIR,
    filename(req, file, callback) {
      callback(null, `${crypto.randomUUID()}${LOGIN_LOGO_EXTENSIONS.get(file.mimetype)}`);
    },
  }),
  limits: { fileSize: LOGIN_LOGO_MAX_BYTES, files: 1 },
  fileFilter(req, file, callback) {
    if (!LOGIN_LOGO_EXTENSIONS.has(file.mimetype)) {
      return callback(new Error("仅支持 PNG、JPG、WebP、GIF、SVG 或 ICO 图片"));
    }
    return callback(null, true);
  },
}).single("file");

function deleteManagedLoginLogo(logoUrl) {
  const prefix = "/login-assets/";
  const value = String(logoUrl || "");
  if (!value.startsWith(prefix)) return;
  const filename = path.basename(value.slice(prefix.length));
  if (!filename) return;
  try {
    fs.unlinkSync(path.join(LOGIN_ASSETS_DIR, filename));
  } catch {}
}

function registerAdminSystemRoutes({
  app,
  store,
  logger,
  requireAdminToken,
  requireAdminRole,
  requireSuperAdminRole,
  requireDangerConfirmation,
  getDefaultSystemConfig,
  getRuntimeConfig,
  updateRuntimeConfig,
}) {
  const isAllowedPublicLink = (value) => {
    const link = String(value || "").trim();
    return (
      !link ||
      link.startsWith("/") ||
      /^https?:\/\//i.test(link) ||
      /^mqqapi:\/\//i.test(link)
    );
  };

  const isAllowedImageLink = (value) => {
    const link = String(value || "").trim();
    return !link || link.startsWith("/") || /^https?:\/\//i.test(link);
  };

  app.get("/api/super-admin-announcement", (req, res) => {
    try {
      res.json({ ok: true, data: store.getSuperAdminAnnouncement() });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post(
    "/api/super-admin/announcement",
    requireAdminToken,
    requireSuperAdminRole,
    (req, res) => {
      try {
        if (
          !requireDangerConfirmation(
            req,
            res,
            "UPDATE_SUPER_ADMIN_ANNOUNCEMENT",
          )
        ) {
          return;
        }

        const { content, password } = req.body;
        const data = store.setSuperAdminAnnouncement(content, password);
        logger.warn("更新超级管理员公告", {
          admin: req.currentUser?.username || "",
          hasContent: !!String(content || "").trim(),
          hasPassword: !!String(password || "").trim(),
          confirmation: "UPDATE_SUPER_ADMIN_ANNOUNCEMENT",
        });
        res.json({ ok: true, data });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    },
  );

  app.post("/api/super-admin-announcement/verify", (req, res) => {
    try {
      const { password } = req.body;
      const valid = store.verifySuperAdminAnnouncementPassword(password);
      res.json({ ok: true, valid });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/announcement", requireAdminToken, (req, res) => {
    try {
      const announcement = { ...store.getAnnouncement() };
      announcement.shouldShow = store.shouldShowAnnouncement(
        req.currentUser?.username,
      );
      res.json({ ok: true, data: announcement });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/announcement/read", requireAdminToken, (req, res) => {
    try {
      if (req.currentUser?.username) {
        store.markAnnouncementRead(req.currentUser.username);
      }
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post(
    "/api/admin/announcement",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      try {
        if (!requireDangerConfirmation(req, res, "UPDATE_ANNOUNCEMENT")) return;
        const { content, showOnce } = req.body || {};
        const data = store.setAnnouncement(content, showOnce);
        logger.warn("更新系统公告", {
          admin: req.currentUser?.username || "",
          hasContent: !!String(content || "").trim(),
          showOnce: showOnce !== false,
          confirmation: "UPDATE_ANNOUNCEMENT",
        });
        res.json({ ok: true, data });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    },
  );

  app.get(
    "/api/admin/system-config",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      try {
        res.json({
          ok: true,
          data: {
            saved: store.getSystemConfig(),
            default: getDefaultSystemConfig(),
            current: getRuntimeConfig(),
          },
        });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    },
  );

  app.get("/api/public/login-links", (req, res) => {
    try {
      res.json({ ok: true, data: store.getLoginLinks() });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get(
    "/api/admin/login-links",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      try {
        res.json({ ok: true, data: store.getLoginLinks() });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    },
  );

  app.post(
    "/api/admin/login-logo",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      loginLogoUpload(req, res, (uploadError) => {
        if (uploadError) {
          return res.status(400).json({ ok: false, error: uploadError.message });
        }
        if (!req.file) {
          return res.status(400).json({ ok: false, error: "请选择要上传的图片" });
        }

        const logoUrl = `/login-assets/${req.file.filename}`;
        const previous = store.getLoginLinks();
        try {
          const data = store.setLoginLinks({ ...previous, logoUrl });
          if (previous.logoUrl !== logoUrl) deleteManagedLoginLogo(previous.logoUrl);
          logger.warn("上传登录页图标", {
            admin: req.currentUser?.username || "",
            logoUrl,
            size: req.file.size,
          });
          return res.json({ ok: true, data });
        } catch (error) {
          deleteManagedLoginLogo(logoUrl);
          return res.status(500).json({ ok: false, error: error.message });
        }
      });
    },
  );

  app.post(
    "/api/admin/login-links",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      try {
        if (!requireDangerConfirmation(req, res, "UPDATE_LOGIN_LINKS")) return;
        const {
          logoUrl,
          title,
          loginSubtitle,
          registerSubtitle,
          purchaseUrl,
          qqGroupUrl,
        } = req.body || {};
        if (!isAllowedPublicLink(purchaseUrl) || !isAllowedPublicLink(qqGroupUrl)) {
          return res.status(400).json({
            ok: false,
            error: "链接仅支持站内路径、http(s) 或 mqqapi 协议",
          });
        }
        if (!isAllowedImageLink(logoUrl)) {
          return res.status(400).json({
            ok: false,
            error: "登录图标仅支持站内路径或 http(s) 图片地址",
          });
        }
        if (
          String(title || "").trim().length > 40 ||
          String(loginSubtitle || "").trim().length > 80 ||
          String(registerSubtitle || "").trim().length > 80
        ) {
          return res.status(400).json({
            ok: false,
            error: "登录页标题最多40字，提示语最多80字",
          });
        }
        const previous = store.getLoginLinks();
        const data = store.setLoginLinks(req.body || {});
        if (previous.logoUrl !== data.logoUrl) deleteManagedLoginLogo(previous.logoUrl);
        logger.warn("更新登录页设置", {
          admin: req.currentUser?.username || "",
          hasCustomLogo: !!data.logoUrl,
          title: data.title,
          purchaseUrl: data.purchaseUrl,
          qqGroupUrl: data.qqGroupUrl,
          confirmation: "UPDATE_LOGIN_LINKS",
        });
        res.json({ ok: true, data });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    },
  );

  app.post(
    "/api/admin/login-links/reset",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      try {
        if (!requireDangerConfirmation(req, res, "RESET_LOGIN_LINKS")) return;
        const previous = store.getLoginLinks();
        const data = store.setLoginLinks(store.DEFAULT_LOGIN_LINKS);
        if (previous.logoUrl !== data.logoUrl) deleteManagedLoginLogo(previous.logoUrl);
        logger.warn("恢复登录页默认设置", {
          admin: req.currentUser?.username || "",
          confirmation: "RESET_LOGIN_LINKS",
        });
        res.json({ ok: true, data });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    },
  );

  app.post(
    "/api/admin/system-config",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      try {
        if (!requireDangerConfirmation(req, res, "UPDATE_SYSTEM_CONFIG")) return;
        const { serverUrl, clientVersion, platform, os } = req.body || {};
        const saved = store.setSystemConfig({
          serverUrl,
          clientVersion,
          platform,
          os,
        });
        updateRuntimeConfig(saved);
        logger.warn("更新系统配置", {
          admin: req.currentUser?.username || "",
          serverUrl: saved?.serverUrl || "",
          clientVersion: saved?.clientVersion || "",
          platform: saved?.platform || "",
          os: saved?.os || "",
          confirmation: "UPDATE_SYSTEM_CONFIG",
        });
        res.json({
          ok: true,
          data: {
            saved,
            current: getRuntimeConfig(),
          },
        });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    },
  );

  app.post(
    "/api/admin/system-config/reset",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      try {
        if (!requireDangerConfirmation(req, res, "RESET_SYSTEM_CONFIG")) return;
        const saved = getDefaultSystemConfig();
        store.setSystemConfig(saved);
        updateRuntimeConfig(saved);
        logger.warn("重置系统配置", {
          admin: req.currentUser?.username || "",
          confirmation: "RESET_SYSTEM_CONFIG",
        });
        res.json({
          ok: true,
          data: {
            saved,
            current: getRuntimeConfig(),
          },
        });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    },
  );

  app.get(
    "/api/admin/wx-config",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      try {
        res.json({ ok: true, data: store.getGlobalWxConfig() });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    },
  );

  app.post(
    "/api/admin/wx-config",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      try {
        if (!requireDangerConfirmation(req, res, "UPDATE_WX_CONFIG")) return;
        const data = store.setGlobalWxConfig(req.body || {});
        logger.warn("更新微信配置", {
          admin: req.currentUser?.username || "",
          enabled: data?.enabled === true,
          autoAddAccount: data?.autoAddAccount === true,
          userIsolation: data?.userIsolation === true,
          apiBase: data?.apiBase || "",
          confirmation: "UPDATE_WX_CONFIG",
        });
        res.json({ ok: true, data });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    },
  );
}

module.exports = { registerAdminSystemRoutes };
