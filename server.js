// 인타임 회사 홈페이지 서버
// public/ 폴더의 화면을 보여 주고, 협업 문의(/api/contact)를 받아 텔레그램으로 알려 줍니다.
// 외부 패키지 없이 Node 기본 기능만 씁니다.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { validateContact, formatContactAlert, createRateLimiter } = require("./lib/contact");
const { sendTelegram, telegramConfigured } = require("./lib/telegram");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const SITE_URL = (process.env.SITE_URL || "https://intimecorp.com").replace(/\/$/, "");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
};

function send(res, status, body, type = "text/plain; charset=utf-8", extra = {}) {
  res.writeHead(status, { "Content-Type": type, ...SECURITY_HEADERS, ...extra });
  res.end(body);
}
const sendJson = (res, status, obj) => send(res, status, JSON.stringify(obj), "application/json; charset=utf-8", { "Cache-Control": "no-store" });

function clientIp(req) {
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return fwd || req.socket.remoteAddress || "unknown";
}

function readBody(req, limit = 20000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error("too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function createServer({ notify = sendTelegram, canNotify = telegramConfigured, limiter = createRateLimiter() } = {}) {
  async function handleContact(req, res) {
    let body;
    try {
      body = JSON.parse((await readBody(req)) || "{}");
    } catch (e) {
      return sendJson(res, e.status || 400, { error: "보낸 내용을 읽지 못했어요. 다시 시도해 주세요." });
    }
    // 사람에게는 안 보이는 칸(website)이 채워져 있으면 자동 프로그램으로 보고 조용히 넘깁니다.
    if (body && body.website) return sendJson(res, 200, { ok: true });
    const result = validateContact(body);
    if (!result.ok) return sendJson(res, 400, { error: result.error });
    if (!limiter(clientIp(req))) {
      return sendJson(res, 429, { error: "잠시 뒤에 다시 보내 주세요. 짧은 시간에 문의가 너무 많이 왔어요." });
    }
    if (!canNotify()) {
      console.error("문의 알림 설정(TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID)이 비어 있어 문의를 받을 수 없어요.");
      return sendJson(res, 503, { error: "지금은 문의를 받을 수 없어요. 잠시 뒤에 다시 시도해 주세요." });
    }
    const sent = await notify(formatContactAlert(result.data));
    if (!sent) return sendJson(res, 502, { error: "문의를 전달하지 못했어요. 잠시 뒤에 다시 시도해 주세요." });
    return sendJson(res, 200, { ok: true });
  }

  function serveStatic(req, res, urlPath) {
    let rel;
    try {
      rel = decodeURIComponent(urlPath);
    } catch {
      return send(res, 400, "Bad Request");
    }
    if (rel === "/") rel = "/index.html";
    if (rel === "/privacy") rel = "/privacy.html";
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, "Forbidden");
    fs.readFile(file, (err, data) => {
      if (err) {
        return fs.readFile(path.join(PUBLIC_DIR, "404.html"), (e2, page) =>
          e2 ? send(res, 404, "Not Found") : send(res, 404, page, TYPES[".html"]));
      }
      const ext = path.extname(file).toLowerCase();
      const isHtml = ext === ".html";
      send(res, 200, req.method === "HEAD" ? "" : data, TYPES[ext] || "application/octet-stream", {
        "Cache-Control": isHtml ? "no-cache" : "public, max-age=86400",
      });
    });
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    try {
      if (url.pathname === "/healthz") return send(res, 200, "ok");
      if (url.pathname === "/robots.txt") {
        return send(res, 200, `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`);
      }
      if (url.pathname === "/sitemap.xml") {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${SITE_URL}/</loc></url>\n  <url><loc>${SITE_URL}/privacy</loc></url>\n</urlset>\n`;
        return send(res, 200, xml, TYPES[".xml"]);
      }
      if (url.pathname === "/api/contact") {
        if (req.method !== "POST") return sendJson(res, 405, { error: "Method Not Allowed" });
        return await handleContact(req, res);
      }
      if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method Not Allowed");
      return serveStatic(req, res, url.pathname);
    } catch (e) {
      console.error("Server error:", e.message);
      if (!res.headersSent) sendJson(res, 500, { error: "잠시 문제가 생겼어요. 다시 시도해 주세요." });
    }
  });
}

if (require.main === module) {
  createServer().listen(PORT, () => {
    console.log(`인타임 홈페이지 서버 시작: 포트 ${PORT}`);
    if (!telegramConfigured()) console.warn("주의: 텔레그램 설정이 없어 협업 문의를 받을 수 없어요.");
  });
}

module.exports = { createServer };
