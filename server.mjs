import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number.parseInt(process.env.PORT ?? "5173", 10);
// Em container, precisa escutar em 0.0.0.0 para expor a porta.
const HOST = process.env.HOST ?? "0.0.0.0";

const SITE_ROOT = __dirname;
const DATA_DIR = path.join(SITE_ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "registry.json");

const SUPABASE_URL =
  process.env.SUPABASE_URL ??
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  process.env.VITE_SUPABASE_URL ??
  "";
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.VITE_SUPABASE_ANON_KEY ??
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  "";
const SUPABASE_TABLE = process.env.SUPABASE_TABLE ?? "registrations";

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".ico":
      return "image/x-icon";
    case ".json":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function json(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readDb() {
  try {
    const raw = await fs.readFile(DB_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { version: 1, records: [] };
    if (!Array.isArray(parsed.records)) return { version: 1, records: [] };
    return { version: 1, records: parsed.records };
  } catch (err) {
    if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) {
      return { version: 1, records: [] };
    }
    throw err;
  }
}

async function writeDb(db) {
  await ensureDataDir();
  const tmpPath = `${DB_PATH}.tmp`;
  const payload = JSON.stringify(db, null, 2);
  await fs.writeFile(tmpPath, payload, "utf8");
  await fs.rename(tmpPath, DB_PATH);
}

function isValidEmail(email) {
  // Intencionalmente simples: valida o mínimo e evita rejeitar e-mails válidos.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function hasSupabaseConfig() {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

async function supabaseFetch(restPath, init = {}) {
  const base = SUPABASE_URL.replace(/\/+$/, "");
  const url = `${base}${restPath.startsWith("/") ? "" : "/"}${restPath}`;
  const headers = new Headers(init.headers ?? {});

  // PostgREST do Supabase aceita ambos; usar service role no backend.
  headers.set("apikey", SUPABASE_KEY);
  headers.set("authorization", `Bearer ${SUPABASE_KEY}`);
  headers.set("accept", "application/json");

  return fetch(url, { ...init, headers });
}

async function supabaseFindByEmail(email) {
  const qs = new URLSearchParams({
    email: `eq.${email}`,
    select: "id,created_at,email",
    limit: "1",
  });
  const resp = await supabaseFetch(`/rest/v1/${encodeURIComponent(SUPABASE_TABLE)}?${qs}`, {
    method: "GET",
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    const msg =
      (data && (data.message || data.error_description || data.error)) ||
      `Erro Supabase (${resp.status})`;
    const err = new Error(msg);
    err.statusCode = 502;
    throw err;
  }
  if (!Array.isArray(data) || data.length === 0) return null;
  return data[0];
}

async function supabaseInsertRegistration({ nome, email, userAgent }) {
  const resp = await supabaseFetch(`/rest/v1/${encodeURIComponent(SUPABASE_TABLE)}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Nao dependemos do corpo de resposta; isso evita exigir SELECT/RLS para retornar a linha.
      prefer: "return=minimal",
    },
    body: JSON.stringify([
      {
        nome,
        email,
        user_agent: userAgent ?? null,
      },
    ]),
  });
  const data = await resp
    .json()
    .catch(async () => {
      // Alguns erros do PostgREST podem vir como corpo vazio (ex.: 404 relation does not exist em POST)
      // Entao tentamos ao menos consumir o body como texto, sem depender disso.
      try {
        const t = await resp.text();
        return t ? { message: t } : null;
      } catch {
        return null;
      }
    });
  if (!resp.ok) {
    const msg =
      (data && (data.message || data.error_description || data.error)) ||
      `Erro Supabase (${resp.status})`;
    const err = new Error(msg);
    err.statusCode = 502;
    err.supabaseStatus = resp.status;
    throw err;
  }
  return true;
}

async function readJsonBody(req, { maxBytes = 64 * 1024 } = {}) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const err = new Error("Payload too large");
      err.statusCode = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const err = new Error("Invalid JSON");
    err.statusCode = 400;
    throw err;
  }
}

async function handleApiRegistry(req, res) {
  const body = await readJsonBody(req);
  const nome = (body?.nome ?? "").toString().trim();
  const email = (body?.email ?? "").toString().trim().toLowerCase();

  if (!nome || nome.length < 2 || nome.length > 120) {
    return json(res, 400, { ok: false, error: "Nome inválido." });
  }
  if (!email || email.length > 254 || !isValidEmail(email)) {
    return json(res, 400, { ok: false, error: "E-mail inválido." });
  }

  if (hasSupabaseConfig()) {
    try {
      await supabaseInsertRegistration({
        nome,
        email,
        userAgent: req.headers["user-agent"] ?? null,
      });

      return json(res, 201, {
        ok: true,
        createdAt: null,
        alreadyRegistered: false,
      });
    } catch (err) {
      // Com apenas ANON key + RLS, o caminho mais seguro e:
      // - permitir INSERT
      // - tratar "email ja existe" como sucesso (sem retornar dados do registro existente)
      const msg = (err?.message ?? "").toString().toLowerCase();
      const isConflict =
        err?.supabaseStatus === 409 ||
        msg.includes("duplicate key") ||
        msg.includes("unique constraint") ||
        msg.includes("already exists");
      if (isConflict) {
        return json(res, 200, {
          ok: true,
          createdAt: null,
          alreadyRegistered: true,
        });
      }
      throw err;
    }
  }

  const db = await readDb();
  const existing = db.records.find((r) => r.email === email);
  if (existing) {
    return json(res, 200, {
      ok: true,
      createdAt: existing.createdAt,
      alreadyRegistered: true,
    });
  }

  const record = {
    id: crypto.randomUUID(),
    nome,
    email,
    createdAt: new Date().toISOString(),
    userAgent: req.headers["user-agent"] ?? null,
  };
  db.records.push(record);
  await writeDb(db);

  return json(res, 201, {
    ok: true,
    createdAt: record.createdAt,
    alreadyRegistered: false,
  });
}

async function serveStatic(req, res) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);

  let relPath = pathname;
  if (relPath === "/") relPath = "/index.html";

  // Normaliza e bloqueia path traversal.
  const safePath = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = path.join(SITE_ROOT, safePath);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(SITE_ROOT) + path.sep)) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  try {
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const data = await fs.readFile(resolved);
    res.writeHead(200, {
      "content-type": contentTypeFor(resolved),
      "content-length": data.length,
      "cache-control": "no-cache",
    });
    res.end(data);
  } catch (err) {
    if (err && err.code === "ENOENT") {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("Internal server error");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, { ok: true });
    }

    if (url.pathname === "/api/registry") {
      if (req.method === "POST") return await handleApiRegistry(req, res);
      res.writeHead(405, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
      res.end("Method not allowed");
      return;
    }

    return await serveStatic(req, res);
  } catch (err) {
    const statusCode = err?.statusCode ?? 500;
    return json(res, statusCode, { ok: false, error: err?.message ?? "Erro" });
  }
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`Servidor: http://${HOST}:${PORT}`);
});

