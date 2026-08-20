// api/storage.js
// Proxy Supabase Storage (buckets "tickets" et "receipts", désormais privés).
// Toutes les actions exigent un jeton de session valide.
//
//  POST /api/storage?action=upload&bucket=tickets&path=xxx.pdf   (corps = fichier brut)
//  POST /api/storage?action=sign     { bucket, path }            → { url } (URL signée 1h)
//  POST /api/storage?action=delete   { bucket, path }
//  POST /api/storage?action=clear    { bucket }                  (admin uniquement — remise à zéro)

import { SUPABASE_URL, sbHeaders, getSession, envError, readRawBody } from "./_lib.js";

const BUCKETS = new Set(["tickets", "receipts"]);
const SIGN_TTL_SECONDS = 3600;

function badPath(p) {
  return typeof p !== "string" || !p || p.includes("..") || p.startsWith("/");
}

export default async (req, res) => {
  const err = envError();
  if (err) {
    res.status(500).json({ ok: false, error: err });
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Méthode non autorisée." });
    return;
  }
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ ok: false, error: "Session expirée — reconnecte-toi." });
    return;
  }

  const url = new URL(req.url, "http://localhost");
  const action = url.searchParams.get("action");

  try {
    if (action === "upload") {
      if (session.role === "client") {
        res.status(403).json({ ok: false, error: "Action réservée au personnel." });
        return;
      }
      const bucket = url.searchParams.get("bucket");
      const path = url.searchParams.get("path");
      if (!BUCKETS.has(bucket) || badPath(path)) {
        res.status(400).json({ ok: false, error: "Bucket ou chemin invalide." });
        return;
      }
      const fileBody = await readRawBody(req);
      const upstream = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
        method: "POST",
        headers: sbHeaders({ "Content-Type": req.headers["content-type"] || "application/pdf" }),
        body: fileBody,
      });
      const text = await upstream.text();
      res.status(upstream.status).send(text);
      return;
    }

    const { bucket, path } = req.body || {};

    if (action === "sign") {
      if (!BUCKETS.has(bucket) || badPath(path)) {
        res.status(400).json({ ok: false, error: "Bucket ou chemin invalide." });
        return;
      }
      const upstream = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${bucket}/${path}`, {
        method: "POST",
        headers: sbHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ expiresIn: SIGN_TTL_SECONDS }),
      });
      if (!upstream.ok) {
        res.status(upstream.status).json({ ok: false, error: await upstream.text().catch(() => "") });
        return;
      }
      const data = await upstream.json();
      res.status(200).json({ ok: true, url: `${SUPABASE_URL}/storage/v1${data.signedURL}` });
      return;
    }

    if (action === "delete") {
      if (session.role === "client") {
        res.status(403).json({ ok: false, error: "Action réservée au personnel." });
        return;
      }
      if (!BUCKETS.has(bucket) || badPath(path)) {
        res.status(400).json({ ok: false, error: "Bucket ou chemin invalide." });
        return;
      }
      const upstream = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
        method: "DELETE",
        headers: sbHeaders(),
      });
      res.status(upstream.ok ? 200 : upstream.status).json({ ok: upstream.ok });
      return;
    }

    if (action === "clear") {
      if (session.role !== "admin") {
        res.status(403).json({ ok: false, error: "Action réservée à l'administrateur." });
        return;
      }
      if (!BUCKETS.has(bucket)) {
        res.status(400).json({ ok: false, error: "Bucket invalide." });
        return;
      }
      const listRes = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${bucket}`, {
        method: "POST",
        headers: sbHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ prefix: "", limit: 1000 }),
      });
      const files = listRes.ok ? await listRes.json() : [];
      if (files && files.length) {
        await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}`, {
          method: "DELETE",
          headers: sbHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ prefixes: files.map((f) => f.name) }),
        });
      }
      res.status(200).json({ ok: true, deleted: (files || []).length });
      return;
    }

    res.status(400).json({ ok: false, error: "Action inconnue." });
  } catch (e) {
    console.error(e);
    res.status(502).json({ ok: false, error: "Erreur de connexion au stockage Supabase." });
  }
};
