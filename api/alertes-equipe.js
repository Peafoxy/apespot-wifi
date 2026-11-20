// api/alertes-equipe.js
// Alertes WhatsApp à l'ÉQUIPE : fournit au robot (sur l'ordinateur toujours
// allumé) la liste des nouveaux événements clients à signaler — nouveau
// paiement, demande de ticket, réclamation — avec, pour chacun, le message
// déjà rédigé et les numéros WhatsApp des membres de l'équipe concernés.
//
//   GET  ?cle=SECRET                 -> { ok, events:[{table,id,recipients,message}] }
//   POST ?cle=SECRET {marks:[{table,id}]} -> marque ces événements comme déjà alertés
//
// Routage (qui reçoit quoi) :
//   - Paiement    -> administrateurs
//   - Ticket      -> administrateurs + techniciens
//   - Réclamation -> administrateurs + techniciens
// Un membre dont la fiche n'a pas de numéro WhatsApp ne reçoit rien.
//
// Les numéros sont lus sur les fiches utilisateurs (wifi_users.telephone), gérés
// depuis l'onglet Utilisateurs de l'app. Le robot n'a donc aucune liste à tenir.

import { SUPABASE_URL, sbHeaders, envError } from "./_lib.js";

const CLE_ROBOT = process.env.ROBOT_WHATSAPP_CLE;
const CLE_CRON = process.env.RELANCE_CRON_SECRET;

const TABLES_AUTORISEES = new Set([
  "wifi_payment_requests",
  "wifi_ticket_requests",
  "wifi_complaints",
]);

function normalizePhone(raw) {
  let d = (raw || "").replace(/[^\d]/g, "");
  if (!d) return "";
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 8) return "228" + d;
  return d;
}

function fmtMontant(n) {
  const v = Number(n);
  if (!isFinite(v)) return String(n ?? "");
  return v.toLocaleString("fr-FR").replace(/ /g, " ");
}

async function lire(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: sbHeaders() });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`lecture ${path} — ${r.status} ${t}`);
  }
  return (await r.json().catch(() => [])) || [];
}

export default async (req, res) => {
  const err = envError();
  if (err) { res.status(500).json({ ok: false, error: err }); return; }

  const cle = (req.query && req.query.cle) || "";
  const autorise = (CLE_ROBOT && cle === CLE_ROBOT) || (CLE_CRON && cle === CLE_CRON);
  if (!autorise) { res.status(401).json({ ok: false, error: "Non autorisé." }); return; }

  // POST : marque des événements comme déjà alertés (après envoi réussi).
  if (req.method === "POST") {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }
    const marks = (body && Array.isArray(body.marks)) ? body.marks : [];
    if (marks.length === 0) { res.status(200).json({ ok: true, marques: 0 }); return; }
    // Regroupe les ids par table.
    const parTable = {};
    for (const m of marks) {
      if (!m || !TABLES_AUTORISEES.has(m.table) || m.id == null) continue;
      (parTable[m.table] = parTable[m.table] || []).push(m.id);
    }
    let total = 0;
    for (const [table, ids] of Object.entries(parTable)) {
      const liste = ids.map((x) => encodeURIComponent(x)).join(",");
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=in.(${liste})`, {
        method: "PATCH",
        headers: sbHeaders({ Prefer: "return=minimal" }),
        body: JSON.stringify({ alertee_equipe: true }),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        res.status(500).json({ ok: false, error: `maj ${table} ${r.status} ${t}` });
        return;
      }
      total += ids.length;
    }
    res.status(200).json({ ok: true, marques: total });
    return;
  }

  // GET : nouveaux événements à signaler.
  try {
    // 1) Numéros de l'équipe par rôle (on ne lit PAS les PIN).
    const membres = await lire("wifi_users?select=role,telephone");
    const numAdmins = [];
    const numTechs = [];
    for (const u of membres) {
      const tel = normalizePhone(u.telephone);
      if (!tel) continue;
      if (u.role === "admin") numAdmins.push(tel);
      else if (u.role === "technicien") numTechs.push(tel);
    }
    const uniq = (arr) => Array.from(new Set(arr));
    const destPaiement = uniq(numAdmins);
    const destTicketRecla = uniq([...numAdmins, ...numTechs]);

    // 2) Nouveaux événements = pas encore alertés (alertee_equipe = false).
    //    L'historique a été backfillé à true, donc seuls les NOUVEAUX ressortent.
    const [paiements, tickets, reclamations] = await Promise.all([
      lire("wifi_payment_requests?select=id,client_nom,montant,mode,note&alertee_equipe=is.false&order=created_at.asc"),
      lire("wifi_ticket_requests?select=id,client_nom,note&alertee_equipe=is.false&order=created_at.asc"),
      lire("wifi_complaints?select=id,client_nom,reason,description,localisation&alertee_equipe=is.false&order=created_at.asc"),
    ]);

    const events = [];

    for (const p of paiements) {
      const lignes = [
        "🔔 *APESPOT* — Nouveau paiement",
        `Client : ${p.client_nom || "?"}`,
        `Montant : ${fmtMontant(p.montant)} F${p.mode ? " · " + p.mode : ""}`,
      ];
      if (p.note) lignes.push(`Note : ${p.note}`);
      lignes.push("➡️ À valider dans l'application.");
      // Un paiement reste signalé même s'il n'y a aucun admin avec numéro :
      // on le marque quand même (recipients vide) pour ne pas le ressortir sans fin.
      events.push({ table: "wifi_payment_requests", id: p.id, recipients: destPaiement, message: lignes.join("\n") });
    }

    for (const t of tickets) {
      const lignes = [
        "🎫 *APESPOT* — Demande de ticket",
        `Client : ${t.client_nom || "?"}`,
      ];
      if (t.note) lignes.push(`Note : ${t.note}`);
      lignes.push("➡️ Voir dans l'application.");
      events.push({ table: "wifi_ticket_requests", id: t.id, recipients: destTicketRecla, message: lignes.join("\n") });
    }

    for (const c of reclamations) {
      const lignes = [
        "📣 *APESPOT* — Nouvelle réclamation",
        `Client : ${c.client_nom || "?"}`,
      ];
      if (c.reason) lignes.push(`Motif : ${c.reason}`);
      if (c.description) lignes.push(`Détail : ${c.description}`);
      if (c.localisation) lignes.push(`Lieu : ${c.localisation}`);
      lignes.push("➡️ Voir dans l'application.");
      events.push({ table: "wifi_complaints", id: c.id, recipients: destTicketRecla, message: lignes.join("\n") });
    }

    res.status(200).json({ ok: true, total: events.length, events });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
};
