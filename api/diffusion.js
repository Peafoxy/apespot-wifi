// api/diffusion.js
// ---------------------------------------------------------------------------
// DIFFUSION (campagne) : l'admin principal compose un message dans l'app et
// choisit une cible (tous / expirés / expire bientôt / à jour / par zone). La
// campagne est stockée dans wifi_diffusions. Le ROBOT WhatsApp interroge cet
// endpoint pour récupérer, PAR LOTS, les prochains destinataires avec le
// message déjà rédigé, puis confirme les envois.
//
//   GET  ?cle=SECRET
//        -> { ok, diffusionId, total(restants), clients:[{id,nom,telephone,message}] }
//        (total = combien il reste à envoyer ; clients = le prochain lot)
//   POST ?cle=SECRET { id:<diffusionId>, ids:[clientId,...] }
//        -> marque ces clients comme envoyés pour CETTE campagne (reprise sûre)
//
// Le robot n'héberge aucune clé base : toute la logique reste ici. Envoi par
// lots + pauses côté robot = anti-blocage WhatsApp.
//
// Lomé = UTC+0 toute l'année : tous les calculs de date se font en UTC.
// ---------------------------------------------------------------------------

import { SUPABASE_URL, sbHeaders, envError } from "./_lib.js";

const CLE_ROBOT = process.env.ROBOT_WHATSAPP_CLE;
const FENETRE_BIENTOT = 4;   // "expire bientôt" = de J (aujourd'hui) à J+4 inclus
const LOT = 40;              // nombre de destinataires renvoyés par appel (lot)

function pad(n) { return String(n).padStart(2, "0"); }
function ymd(d) { return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
function greeting(h) { return (h >= 18 || h < 5) ? "Bonsoir" : "Bonjour"; }

function normServeur(s) {
  return String(s || "").toUpperCase().replace(/SERVEUR/g, "").replace(/[^A-Z0-9]/g, "");
}

// Même règle que l'app : chiffres seuls ; numéro local togolais 8 chiffres -> 228.
function normalizePhone(raw) {
  let d = (raw || "").replace(/[^\d]/g, "");
  if (!d) return "";
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 8) return "228" + d;
  return d;
}

// Construit le message final : préfixe "Bonjour <nom>" si demandé, puis le texte.
function buildMessage(diff, nom, h) {
  const corps = String(diff.message || "").trim();
  if (diff.inclure_nom) {
    return `${greeting(h)} ${nom || ""}`.trim() + "\n\n" + corps;
  }
  return corps;
}

// Récupère la campagne active la plus ancienne (une à la fois).
async function campagneActive() {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/wifi_diffusions?statut=eq.active&order=created_at.asc&limit=1`,
    { headers: sbHeaders() }
  );
  if (!r.ok) return null;
  const rows = (await r.json().catch(() => [])) || [];
  return rows[0] || null;
}

// Clients ciblés par la campagne (hors filtre "déjà envoyés", fait ensuite en JS).
async function clientsCibles(diff, todayStr) {
  const base = "wifi_clients?select=id,nom,telephone,date_exp,serveur";
  let filtre = "";
  if (diff.cible === "expires") {
    filtre = `&date_exp=not.is.null&date_exp=lt.${todayStr}`;
  } else if (diff.cible === "bientot") {
    const fin = ymd(new Date(new Date(todayStr + "T00:00:00Z").getTime() + FENETRE_BIENTOT * 86400000));
    filtre = `&date_exp=gte.${todayStr}&date_exp=lte.${fin}`;
  } else if (diff.cible === "ajour") {
    filtre = `&date_exp=gte.${todayStr}`;
  } else if (diff.cible === "zone") {
    const z = normServeur(diff.zone);
    filtre = `&or=(serveur.ilike.SERVEUR*${z},serveur.ilike.${z})`;
  }
  // "tous" -> aucun filtre
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${base}${filtre}`, { headers: sbHeaders() });
  if (!r.ok) return [];
  return (await r.json().catch(() => [])) || [];
}

export default async (req, res) => {
  const err = envError();
  if (err) { res.status(500).json({ ok: false, error: err }); return; }
  if (!CLE_ROBOT) { res.status(500).json({ ok: false, error: "ROBOT_WHATSAPP_CLE manquante." }); return; }

  const cle = (req.query && req.query.cle) || "";
  if (cle !== CLE_ROBOT) { res.status(401).json({ ok: false, error: "Non autorisé." }); return; }

  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const todayStr = ymd(today);

  // -------- POST : confirmer les envois d'un lot --------
  if (req.method === "POST") {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }
    const diffId = body && body.id;
    const ids = (body && Array.isArray(body.ids)) ? body.ids.filter((x) => x != null).map(String) : [];
    if (!diffId) { res.status(400).json({ ok: false, error: "id de diffusion manquant." }); return; }
    if (ids.length === 0) { res.status(200).json({ ok: true, marques: 0 }); return; }

    // Lire la campagne, fusionner les ids déjà envoyés (reprise sûre), réécrire.
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/wifi_diffusions?id=eq.${encodeURIComponent(diffId)}&select=id,envoyes_ids,envoyes`,
      { headers: sbHeaders() }
    );
    const rows = r.ok ? ((await r.json().catch(() => [])) || []) : [];
    const diff = rows[0];
    if (!diff) { res.status(404).json({ ok: false, error: "Diffusion introuvable." }); return; }

    const dejaArr = Array.isArray(diff.envoyes_ids) ? diff.envoyes_ids.map(String) : [];
    const set = new Set(dejaArr);
    for (const id of ids) set.add(id);
    const nouveau = Array.from(set);

    const up = await fetch(`${SUPABASE_URL}/rest/v1/wifi_diffusions?id=eq.${encodeURIComponent(diffId)}`, {
      method: "PATCH",
      headers: sbHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify({ envoyes_ids: nouveau, envoyes: nouveau.length }),
    });
    if (!up.ok) {
      const t = await up.text().catch(() => "");
      res.status(500).json({ ok: false, error: `maj ${up.status} ${t}` });
      return;
    }
    res.status(200).json({ ok: true, marques: ids.length, total_envoyes: nouveau.length });
    return;
  }

  // -------- GET : prochain lot de destinataires --------
  const diff = await campagneActive();
  if (!diff) { res.status(200).json({ ok: true, diffusionId: null, total: 0, clients: [] }); return; }

  const cibles = await clientsCibles(diff, todayStr);
  const dejaSet = new Set((Array.isArray(diff.envoyes_ids) ? diff.envoyes_ids : []).map(String));
  const z = diff.cible === "zone" ? normServeur(diff.zone) : null;
  const h = now.getUTCHours();

  const restants = [];
  for (const c of cibles) {
    if (dejaSet.has(String(c.id))) continue;                 // déjà envoyé
    if (z && normServeur(c.serveur) !== z) continue;          // garde-fou zone
    const tel = normalizePhone(c.telephone);
    if (!tel) continue;                                       // pas de numéro valide
    restants.push({ id: c.id, nom: c.nom, telephone: tel, message: buildMessage(diff, c.nom, h) });
  }

  // Plus rien à envoyer : on clôt la campagne.
  if (restants.length === 0) {
    await fetch(`${SUPABASE_URL}/rest/v1/wifi_diffusions?id=eq.${encodeURIComponent(diff.id)}`, {
      method: "PATCH",
      headers: sbHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify({ statut: "termine" }),
    }).catch(() => {});
    res.status(200).json({ ok: true, diffusionId: diff.id, total: 0, clients: [] });
    return;
  }

  res.status(200).json({
    ok: true,
    diffusionId: diff.id,
    total: restants.length,          // combien il reste au total
    clients: restants.slice(0, LOT), // le prochain lot
  });
};
