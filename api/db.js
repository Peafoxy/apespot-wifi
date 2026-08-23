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

// Tables réservées à l'ADMINISTRATEUR (jamais un technicien). wifi_users
// contient les PIN de connexion : un technicien qui pourrait la lire verrait
// les codes des admins et se connecterait à leur place. On la réserve donc à
// l'admin, quel que soit le sens de l'accès (lecture / écriture).
const ADMIN_ONLY_TABLES = new Set(["wifi_users"]);

// Cloisonnement des sessions "client" : une session client ne peut atteindre
// QUE ses propres lignes, et seulement via les méthodes strictement
// nécessaires à son espace. Sans cela, un client connecté pouvait lire les
// codes d'accès / paiements / messages de TOUS les clients, ou supprimer des
// données d'autrui. La colonne de cloisonnement est ajoutée côté serveur à
// chaque requête de lecture / modification / suppression : le client ne
// choisit jamais quelles lignes il touche.
//   - `col` = colonne filtrée ; `by` = "sub" (id du client) ou "nom".
//   - `methods` = méthodes autorisées pour ce rôle sur cette table.
const CLIENT_TABLE_RULES = {
  // Le client lit sa fiche, et peut mettre à jour UNIQUEMENT sa position
  // (partage de localisation) — jamais sa date d'expiration ni son code.
  wifi_clients: { methods: ["GET", "PATCH"], col: "id", by: "sub", allowBodyKeys: ["latitude", "longitude"] },
  wifi_payments: { methods: ["GET"], col: "client_nom", by: "nom" },
  wifi_messages: { methods: ["GET", "POST", "PATCH"], col: "client_nom", by: "nom" },
  wifi_complaints: { methods: ["GET", "POST"], col: "client_nom", by: "nom" },
  wifi_payment_requests: { methods: ["GET", "POST"], col: "client_nom", by: "nom" },
  wifi_ticket_requests: { methods: ["GET", "POST", "PATCH", "DELETE"], col: "client_nom", by: "nom" },
  // Réglages et durées de tickets : configuration partagée, lecture seule.
  wifi_settings: { methods: ["GET"], col: null },
  wifi_ticket_durations: { methods: ["GET"], col: null },
};

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

  // Tables réservées à l'admin : refusées à tout autre rôle (technicien, client).
  if (session.role !== "admin" && ADMIN_ONLY_TABLES.has(table)) {
    res.status(403).json({ ok: false, error: "Table réservée à l'administrateur." });
    return;
  }

  let scopedPath = path;
  let corps = body; // corps de la requête, éventuellement réécrit ci-dessous

  if (session.role === "client") {
    if (STAFF_ONLY_TABLES.has(table)) {
      res.status(403).json({ ok: false, error: "Table non autorisée pour ce rôle." });
      return;
    }
    const rule = CLIENT_TABLE_RULES[table];
    if (!rule || !rule.methods.includes(m)) {
      res.status(403).json({ ok: false, error: "Opération non autorisée pour ce rôle." });
      return;
    }
    // Interdit les sélections imbriquées PostgREST (`table(...)`) qui
    // permettaient de contourner le cloisonnement en embarquant une table
    // du personnel dans un select.
    if (scopedPath.includes("(")) {
      res.status(403).json({ ok: false, error: "Requête non autorisée pour ce rôle." });
      return;
    }
    // Quand la table restreint les champs modifiables (ex. wifi_clients :
    // seulement latitude/longitude), on refuse tout autre champ dans le corps
    // — un client ne doit pas pouvoir changer sa date d'expiration ou son code.
    if (rule.allowBodyKeys && (m === "POST" || m === "PATCH")) {
      let parsed = body;
      if (typeof parsed === "string") {
        try { parsed = JSON.parse(parsed); } catch { parsed = null; }
      }
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      const invalide = rows.some((row) =>
        !row || typeof row !== "object" || Object.keys(row).some((k) => !rule.allowBodyKeys.includes(k))
      );
      if (invalide) {
        res.status(403).json({ ok: false, error: "Champ non autorisé pour ce rôle." });
        return;
      }
    }
    // INSERT (POST) : on IMPOSE l'appartenance au client connecté. La colonne
    // de cloisonnement (client_nom) et l'id propriétaire (client_id) sont
    // réécrits côté serveur, quelles que soient les valeurs envoyées. Sans
    // cela, un client pouvait créer un message / une réclamation / une demande
    // AU NOM d'un autre client (usurpation).
    if (rule.col && m === "POST") {
      const value = rule.by === "sub" ? session.sub : session.nom;
      if (value == null) {
        res.status(403).json({ ok: false, error: "Session incomplète." });
        return;
      }
      let parsed = corps;
      if (typeof parsed === "string") {
        try { parsed = JSON.parse(parsed); } catch { parsed = null; }
      }
      if (parsed == null || typeof parsed !== "object") {
        res.status(400).json({ ok: false, error: "Corps de requête invalide." });
        return;
      }
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      for (const row of rows) {
        if (!row || typeof row !== "object") {
          res.status(400).json({ ok: false, error: "Corps de requête invalide." });
          return;
        }
        row[rule.col] = value; // ex. client_nom = nom du client connecté
        if (session.sub != null) row.client_id = session.sub; // id propriétaire
      }
      corps = Array.isArray(parsed) ? rows : rows[0];
    }
    // Cloisonnement : on force le filtre sur les lignes du client pour toute
    // lecture / modification / suppression. Un filtre déjà présent qui
    // pointerait ailleurs se combine en ET → aucun résultat (donc sûr).
    if (rule.col && (m === "GET" || m === "PATCH" || m === "DELETE")) {
      const value = rule.by === "sub" ? session.sub : session.nom;
      if (value == null) {
        res.status(403).json({ ok: false, error: "Session incomplète." });
        return;
      }
      const sep = scopedPath.includes("?") ? "&" : "?";
      scopedPath = `${scopedPath}${sep}${rule.col}=eq.${encodeURIComponent(value)}`;
    }
  }

  try {
    const headers = sbHeaders({
      "Content-Type": "application/json",
      Prefer: prefer || "return=representation",
    });
    const upstream = await fetch(`${SUPABASE_URL}/rest/v1/${scopedPath}`, {
      method: m,
      headers,
      body: corps === undefined || corps === null ? undefined : (typeof corps === "string" ? corps : JSON.stringify(corps)),
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
