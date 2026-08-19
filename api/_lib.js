// api/_lib.js
// Helpers partagés par les fonctions serveur Vercel (le préfixe "_" empêche
// Vercel de transformer ce fichier en route).
//
// - Accès Supabase avec la clé service_role (jamais envoyée au navigateur).
// - Jetons de session signés (HMAC-SHA256) : le navigateur ne détient plus
//   aucune clé Supabase, seulement un jeton temporaire délivré par /api/login.

import crypto from "node:crypto";

export const SUPABASE_URL = process.env.SUPABASE_URL;
export const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SESSION_SECRET = process.env.APP_SESSION_SECRET;

export const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h — la déconnexion d'inactivité côté app reste bien plus courte.

export function envError() {
  if (!SUPABASE_URL) return "SUPABASE_URL manquante sur Vercel.";
  if (!SERVICE_KEY) return "SUPABASE_SERVICE_ROLE_KEY manquante sur Vercel.";
  if (!SESSION_SECRET) return "APP_SESSION_SECRET manquante sur Vercel.";
  return null;
}

export function sbHeaders(extra = {}) {
  const h = { apikey: SERVICE_KEY };
  // Les anciennes clés Supabase sont des JWT ("eyJ...") et se passent aussi en
  // Authorization. Les nouvelles clés (sb_secret_...) ne sont PAS des JWT :
  // elles se passent uniquement dans l'en-tête apikey — un Authorization:
  // Bearer avec une clé non-JWT ferait rejeter la requête.
  if (SERVICE_KEY && SERVICE_KEY.startsWith("eyJ")) {
    h.Authorization = `Bearer ${SERVICE_KEY}`;
  }
  return { ...h, ...extra };
}

// ---- Jetons de session ----

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

function hmac(data) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(data).digest("base64url");
}

export function signToken(payload) {
  const body = b64url(JSON.stringify({ ...payload, exp: Date.now() + TOKEN_TTL_MS }));
  return `${body}.${hmac(body)}`;
}

export function verifyToken(token) {
  if (!SESSION_SECRET || !token || typeof token !== "string") return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = hmac(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

// Renvoie la session ({ sub, nom, role, exp }) ou null. Cherche le jeton dans
// l'en-tête Authorization: Bearer <token>.
export function getSession(req) {
  const h = req.headers["authorization"] || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? verifyToken(m[1].trim()) : null;
}

// Corps brut de la requête (pour l'upload de fichiers). Vercel a parfois déjà
// consommé le flux et rempli req.body : on le réutilise dans ce cas.
export async function readRawBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (Buffer.isBuffer(req.body)) return req.body;
    if (typeof req.body === "string") return Buffer.from(req.body);
    return Buffer.from(JSON.stringify(req.body));
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
