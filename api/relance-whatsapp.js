// api/relance-whatsapp.js
// Fournit au ROBOT WhatsApp (installé sur l'ordinateur toujours allumé) la liste
// des clients à notifier aujourd'hui, avec le message déjà rédigé — exactement
// le même texte que celui que l'app propose au personnel. Le robot n'héberge
// ainsi AUCUNE clé de base de données : toute la logique et les accès restent ici.
//
//   GET  ?cle=SECRET              -> { ok, date, total, clients:[{id,nom,telephone,jours,message}] }
//   POST ?cle=SECRET  {ids:[...]} -> marque relance_le = aujourd'hui pour ces clients
//
// Fenêtre de notification = clients dont l'abonnement expire d'aujourd'hui (J)
// à J+4 inclus, ET pas encore relancés aujourd'hui. On NE notifie PAS les
// abonnements déjà expirés (relance alors laissée à l'administration), ce qui
// reproduit le comportement du cron existant (relance-activite.js).
//
// Lomé = UTC+0 toute l'année : tous les calculs de date se font en UTC, ce qui
// correspond à l'heure locale togolaise.

import { SUPABASE_URL, sbHeaders, envError } from "./_lib.js";

const CLE_ROBOT = process.env.ROBOT_WHATSAPP_CLE;
const CLE_CRON = process.env.RELANCE_CRON_SECRET;
const FENETRE_JOURS = 4; // de J (expire aujourd'hui) à J+4 inclus

function pad(n) { return String(n).padStart(2, "0"); }
function ymd(d) { return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }

function fmtDateFr(dateExp) {
  const d = new Date(dateExp + "T00:00:00Z");
  if (isNaN(d.getTime())) return dateExp;
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

function joursRestants(dateExp, today) {
  const exp = new Date(dateExp + "T00:00:00Z");
  return Math.round((exp - today) / 86400000);
}

function greeting(h) { return (h >= 18 || h < 5) ? "Bonsoir" : "Bonjour"; }

// Même règle que l'app (normalizePhone) : chiffres seuls ; un numéro local
// togolais à 8 chiffres reçoit l'indicatif 228.
function normalizePhone(raw) {
  let d = (raw || "").replace(/[^\d]/g, "");
  if (!d) return "";
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 8) return "228" + d;
  return d;
}

// Reproduit buildWaMessage() de src/App.jsx pour un envoi identique.
function buildMessage(c, jours, h) {
  const dateTxt = fmtDateFr(c.date_exp);
  let statusLines;
  if (jours < 0) {
    statusLines = `Votre abonnement WiFi APESPOT a *expiré le ${dateTxt}*\nMerci de renouveler pour rétablir votre connexion.`;
  } else if (jours === 0) {
    statusLines = `Votre abonnement WiFi APESPOT *expire aujourd'hui* (${dateTxt})\nMerci de renouveler rapidement pour éviter une coupure.`;
  } else {
    statusLines = `Votre abonnement WiFi APESPOT expire le *${dateTxt}* (dans ${jours} jour${jours > 1 ? "s" : ""})\nMerci de prévoir le renouvellement.`;
  }
  const closing = "Accède à ton espace pour payer ou soumettre une réclamation";
  const codeLine = c.access_code ? `TON CODE : ${c.access_code}` : "(demande ton code à APESPOT WI-FI)";
  return [
    `${greeting(h)} ${c.nom}`,
    ``,
    statusLines,
    ``,
    `Click sur : `,
    ``,
    `https://apespot-wifi.vercel.app`,
    ``,
    `Vas sur *client* `,
    ``,
    codeLine,
    ``,
    closing,
  ].join("\n");
}

export default async (req, res) => {
  const err = envError();
  if (err) { res.status(500).json({ ok: false, error: err }); return; }

  // Autorisation fail-closed : il faut la clé du robot (ou, à défaut, celle du
  // cron existant). Sans clé configurée côté serveur, on refuse tout.
  const cle = (req.query && req.query.cle) || "";
  const autorise = (CLE_ROBOT && cle === CLE_ROBOT) || (CLE_CRON && cle === CLE_CRON);
  if (!autorise) {
    res.status(401).json({ ok: false, error: "Non autorisé." });
    return;
  }

  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const todayStr = ymd(today);

  // POST : marque les clients comme relancés aujourd'hui.
  if (req.method === "POST") {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }
    const ids = (body && Array.isArray(body.ids)) ? body.ids.filter((x) => x != null) : [];
    if (ids.length === 0) { res.status(200).json({ ok: true, marques: 0 }); return; }
    const liste = ids.map((x) => encodeURIComponent(x)).join(",");
    const r = await fetch(`${SUPABASE_URL}/rest/v1/wifi_clients?id=in.(${liste})`, {
      method: "PATCH",
      headers: sbHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify({ relance_le: todayStr }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      res.status(500).json({ ok: false, error: `maj ${r.status} ${t}` });
      return;
    }
    res.status(200).json({ ok: true, marques: ids.length });
    return;
  }

  // GET : liste des clients à notifier aujourd'hui.
  const fin = ymd(new Date(today.getTime() + FENETRE_JOURS * 86400000));
  const path =
    `wifi_clients?select=id,nom,telephone,date_exp,access_code` +
    `&date_exp=gte.${todayStr}&date_exp=lte.${fin}` +
    `&or=(relance_le.is.null,relance_le.lt.${todayStr})`;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: sbHeaders() });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    res.status(500).json({ ok: false, error: `lecture ${r.status} ${t}` });
    return;
  }
  const rows = (await r.json().catch(() => [])) || [];
  const h = now.getUTCHours();
  const clients = [];
  for (const c of rows) {
    const tel = normalizePhone(c.telephone);
    if (!tel) continue; // pas de numéro valide → on ne peut pas envoyer
    const jours = joursRestants(c.date_exp, today);
    clients.push({ id: c.id, nom: c.nom, telephone: tel, jours, message: buildMessage(c, jours, h) });
  }
  res.status(200).json({ ok: true, date: todayStr, total: clients.length, clients });
};
