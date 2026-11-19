// api/pppoe-sync.js
// ---------------------------------------------------------------------------
// Synchro PPPoE : chaque MikroTik envoie la liste de SES comptes et reçoit,
// pour chacun, quoi faire (activer / couper / supprimer). Lecture seule côté
// routeurs — c'est le script (pppoe-sync.rsc) qui applique localement.
//
//   Appel : GET /api/pppoe-sync?serveur=V11&token=SECRET&reel=0|1
//                &tous=NOM,NOM,...    (TOUS les comptes du routeur)
//                &actifs=NOM,NOM,...  (comptes CONNECTÉS maintenant)
//   Auth  : token partagé = variable d'environnement PPPOE_SYNC_SECRET.
//
//   Réponse :
//     #APESPOT V11 12
//     E BADAMELI   (activer : client à jour)
//     D GOUDO      (couper : échéance dépassée)
//     X VIEUX      (supprimer : inactif depuis 3 mois)
//
// IMPORTANT (choix d'architecture) : la décision se fait PAR LE NOM, à partir
// des comptes que le routeur dit avoir — PAS à partir de l'étiquette « serveur »
// du client. Ainsi, chaque routeur gère exactement les comptes qu'il contient,
// quelle que soit la répartition. L'étiquette « serveur » reste stockée (pour
// l'affichage/filtre humain) et sert à nommer les comptes nouvellement importés.
//
// reel=1 (mode réel) : le site enregistre aussi — crée les comptes inconnus
// (sans date) et met à jour le suivi des connexions. reel=0 (test) : le site
// ne fait que CALCULER et renvoyer les prévisions, il n'écrit rien.
// ---------------------------------------------------------------------------

import { SUPABASE_URL, sbHeaders, envError, readRawBody } from "./_lib.js";

// Lit les paramètres en POST (corps, pour les longues listes de comptes) OU en
// GET (query, pour un test simple). En POST, le routeur envoie
// "serveur=..&token=..&reel=..&tous=..&actifs=.." dans le corps, ce qui évite
// toute limite de longueur d'URL.
async function lireParams(req) {
  const q = { ...(req.query || {}) };
  if (req.method === "POST") {
    if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
      return { ...q, ...req.body };
    }
    try {
      const raw = (await readRawBody(req)).toString();
      return { ...q, ...Object.fromEntries(new URLSearchParams(raw)) };
    } catch { /* on retombe sur la query */ }
  }
  return q;
}

const MAX_IMPORT = 100;
const MS_3_MOIS = 90 * 24 * 60 * 60 * 1000;

function normServeur(s) {
  return String(s || "").toUpperCase().replace(/SERVEUR/g, "").replace(/[^A-Z0-9]/g, "");
}
function normNom(s) {
  return String(s || "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}
function joursAvant(dateExp) {
  if (!dateExp) return null;
  const exp = new Date(dateExp + "T00:00:00");
  if (isNaN(exp.getTime())) return null;
  const now = new Date();
  return Math.round((exp - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
}

export default async (req, res) => {
  const err = envError();
  if (err) return res.status(500).send("# " + err);
  const SECRET = process.env.PPPOE_SYNC_SECRET;
  if (!SECRET) return res.status(500).send("# PPPOE_SYNC_SECRET manquante sur Vercel.");

  const q = await lireParams(req);
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers["authorization"] || "");
  const token = q.token || (bearer ? bearer[1].trim() : null);
  const serveur = normServeur(q.serveur);          // étiquette (import + affichage)
  const reel = String(q.reel || "") === "1";       // autorise les écritures côté site
  if (!serveur) return res.status(400).send("# parametre 'serveur' manquant");
  if (!token || token !== SECRET) return res.status(401).send("# token invalide");

  // Comptes du routeur : on garde le NOM BRUT (ce que le routeur a vraiment,
  // à renvoyer tel quel pour qu'il le retrouve) indexé par sa forme normalisée.
  const reporte = new Map(); // norm -> nom brut
  for (const raw of String(q.tous || "").split(",")) {
    const nom = raw.trim();
    const n = normNom(nom);
    if (n && !reporte.has(n)) reporte.set(n, nom);
  }
  const connectes = new Set(String(q.actifs || "").split(",").map(normNom).filter(Boolean));

  async function patch(ids, corps) {
    if (!ids.length) return;
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/wifi_clients?id=in.(${ids.map(encodeURIComponent).join(",")})`, {
        method: "PATCH",
        headers: sbHeaders({ "Content-Type": "application/json", Prefer: "return=minimal" }),
        body: JSON.stringify(corps),
      });
    } catch (e) { console.error("PPPoE patch:", e); }
  }

  try {
    const upstream = await fetch(
      `${SUPABASE_URL}/rest/v1/wifi_clients?select=id,nom,pppoe_login,date_exp,derniere_connexion_vue,suivi_depuis`,
      { headers: sbHeaders({ Accept: "application/json" }) }
    );
    if (!upstream.ok) return res.status(502).send("# erreur base");
    const clients = await upstream.json();

    // Index NOM normalisé -> client (par nom ET par pppoe_login).
    const parNom = new Map();
    for (const c of clients) {
      const n = normNom(c.nom); if (n && !parNom.has(n)) parNom.set(n, c);
      const p = normNom(c.pppoe_login); if (p && !parNom.has(p)) parNom.set(p, c);
    }

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    // ---- Mode réel : import des inconnus + suivi des connexions -------------
    if (reel) {
      const aCreer = [];
      for (const [n, nom] of reporte) {
        if (parNom.has(n)) continue;
        aCreer.push({ nom, serveur: `SERVEUR ${serveur}`, date_exp: null, pppoe_login: null });
        if (aCreer.length >= MAX_IMPORT) break;
      }
      if (aCreer.length > 0) {
        try {
          await fetch(`${SUPABASE_URL}/rest/v1/wifi_clients`, {
            method: "POST",
            headers: sbHeaders({ "Content-Type": "application/json", Prefer: "return=minimal" }),
            body: JSON.stringify(aCreer),
          });
          for (const row of aCreer) parNom.set(normNom(row.nom), { ...row, id: null });
        } catch (e) { console.error("PPPoE import:", e); }
      }

      const idsSuiviNull = [];
      const idsVus = [];
      for (const [n] of reporte) {
        const c = parNom.get(n);
        if (!c || !c.id) continue;
        if (!c.suivi_depuis) idsSuiviNull.push(c.id);
        if (connectes.has(n)) idsVus.push(c.id);
      }
      await patch(idsSuiviNull, { suivi_depuis: nowIso });
      await patch(idsVus, { derniere_connexion_vue: nowIso });
    }

    // ---- Décision E / D / X, pour chaque compte du routeur ------------------
    const lignes = [];
    for (const [n, nom] of reporte) {
      const c = parNom.get(n);
      if (!c) continue;                               // inconnu (et pas importé en test) -> on ignore

      // Suppression : jamais si connecté ; suivi d'au moins 3 mois ET pas vu
      // connecté depuis 3 mois.
      const suiviMs = c.suivi_depuis ? new Date(c.suivi_depuis).getTime() : nowMs;
      const vuMs = c.derniere_connexion_vue ? new Date(c.derniere_connexion_vue).getTime() : null;
      if (!connectes.has(n) && (nowMs - suiviMs) > MS_3_MOIS && (vuMs === null || (nowMs - vuMs) > MS_3_MOIS)) {
        lignes.push(`X ${nom}`);
        continue;
      }
      const j = joursAvant(c.date_exp);
      if (j === null) continue;                       // pas de date -> on ne touche pas
      lignes.push(`${j <= 0 ? "D" : "E"} ${nom}`);
    }

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(`#APESPOT ${serveur} ${lignes.length}\n${lignes.join("\n")}\n`);
  } catch (e) {
    console.error(e);
    return res.status(502).send("# erreur serveur");
  }
};
