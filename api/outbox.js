// api/outbox.js
// ---------------------------------------------------------------------------
// FILE D'ENVOI (outbox) : l'app dépose un message à envoyer à UN client
// (relance, bonus, bienvenue, confirmation de réabonnement) dans la table
// wifi_outbox. Le ROBOT WhatsApp interroge cet endpoint pour récupérer les
// messages en attente et les envoyer automatiquement — l'utilisateur n'a plus
// à ouvrir WhatsApp.
//
//   GET  ?cle=SECRET            -> { ok, total, messages:[{id,telephone,nom,message}] }
//   POST ?cle=SECRET {ids:[..]} -> marque ces messages comme envoyés
//
// Le message est déjà entièrement rédigé par l'app (greeting + nom inclus) :
// le robot l'envoie tel quel. Le robot n'héberge aucune clé base.
// ---------------------------------------------------------------------------

import { SUPABASE_URL, sbHeaders, envError } from "./_lib.js";

const CLE_ROBOT = process.env.ROBOT_WHATSAPP_CLE;
const LOT = 30; // messages renvoyés par appel

// Chiffres seuls ; numéro local togolais 8 chiffres -> 228.
function normalizePhone(raw) {
  let d = (raw || "").replace(/[^\d]/g, "");
  if (!d) return "";
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 8) return "228" + d;
  return d;
}

export default async (req, res) => {
  const err = envError();
  if (err) { res.status(500).json({ ok: false, error: err }); return; }
  if (!CLE_ROBOT) { res.status(500).json({ ok: false, error: "ROBOT_WHATSAPP_CLE manquante." }); return; }

  const cle = (req.query && req.query.cle) || "";
  if (cle !== CLE_ROBOT) { res.status(401).json({ ok: false, error: "Non autorisé." }); return; }

  // Battement de coeur : le robot prouve qu'il est en vie a chaque passage
  // (toutes les minutes). L'app lit cette date pour savoir si le robot tourne,
  // et proposer un envoi manuel s'il est injoignable. Fire-and-forget.
  fetch(`${SUPABASE_URL}/rest/v1/wifi_robot_status?on_conflict=id`, {
    method: "POST",
    headers: sbHeaders({ Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify({ id: "robot", last_seen: new Date().toISOString() }),
  }).catch(() => {});

  // -------- POST : marquer des messages comme envoyés --------
  if (req.method === "POST") {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }
    const ids = (body && Array.isArray(body.ids)) ? body.ids.filter((x) => x != null) : [];
    if (ids.length === 0) { res.status(200).json({ ok: true, marques: 0 }); return; }
    const liste = ids.map((x) => encodeURIComponent(x)).join(",");
    const r = await fetch(`${SUPABASE_URL}/rest/v1/wifi_outbox?id=in.(${liste})`, {
      method: "PATCH",
      headers: sbHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify({ statut: "envoye" }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      res.status(500).json({ ok: false, error: `maj ${r.status} ${t}` });
      return;
    }
    res.status(200).json({ ok: true, marques: ids.length });
    return;
  }

  // -------- GET : messages en attente --------
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/wifi_outbox?statut=eq.en_attente&select=id,telephone,nom,message&order=created_at.asc&limit=${LOT}`,
    { headers: sbHeaders() }
  );
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    res.status(502).json({ ok: false, error: `lecture ${r.status} ${t}` });
    return;
  }
  const rows = (await r.json().catch(() => [])) || [];
  const messages = [];
  for (const m of rows) {
    const tel = normalizePhone(m.telephone);
    if (!tel || !m.message) continue;
    messages.push({ id: m.id, telephone: tel, nom: m.nom || "", message: m.message });
  }
  res.status(200).json({ ok: true, total: messages.length, messages });
};
