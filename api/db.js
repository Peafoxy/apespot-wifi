// api/db.js
// Proxy base de données : le navigateur n'a plus aucune clé Supabase.
// Chaque requête doit porter un jeton de session valide (délivré par /api/login) ;
// le serveur relaie alors la requête vers PostgREST avec la clé service_role.
//
// POST { path: "wifi_clients?select=*", method: "GET"|"POST"|"PATCH"|"DELETE", body?, prefer? }
//
// Le RLS étant activé sans policy sur les tables wifi_*, la clé anon publique
// ne peut plus rien lire ni écrire : ce proxy est le seul chemin d'accès.

import { SUPABASE_URL, sbHeaders, getSession, envError } from "./_lib.js";

const ALL_METHODS = ["GET", "POST", "PATCH", "DELETE"];

// Tables interdites aux sessions "client" : comptes du personnel (PIN),
// journal d'activité et toute la comptabilité interne.
const STAFF_ONLY_TABLES = new Set([
  "wifi_users",
  "wifi_activity_log",
  "wifi_fuel_expenses",
  "wifi_expense_lines",
  "wifi_perdiem",
  "wifi_other_expenses",
  "wifi_push_subscriptions",
]);

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

  const { path, method = "GET", body, prefer } = req.body || {};
  const m = String(method).toUpperCase();
  if (typeof path !== "string" || !ALL_METHODS.includes(m)) {
    res.status(400).json({ ok: false, error: "Requête invalide." });
    return;
  }

  // Seules les tables wifi_* de l'application sont accessibles via ce proxy.
  const table = path.split("?")[0].split("/")[0];
  if (!/^wifi_[a-z_]+$/.test(table)) {
    res.status(403).json({ ok: false, error: "Table non autorisée." });
    return;
  }
  if (session.role === "client" && STAFF_ONLY_TABLES.has(table)) {
    res.status(403).json({ ok: false, error: "Table non autorisée pour ce rôle." });
    return;
  }

  try {
    const headers = sbHeaders({
      "Content-Type": "application/json",
      Prefer: prefer || "return=representation",
    });
    const upstream = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      method: m,
      headers,
      body: body === undefined || body === null ? undefined : (typeof body === "string" ? body : JSON.stringify(body)),
    });
    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
    res.send(text);
  } catch (e) {
    console.error(e);
    res.status(502).json({ ok: false, error: "Erreur de connexion à Supabase." });
  }
};
