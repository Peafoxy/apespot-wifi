// api/pppoe-sync.js
// ---------------------------------------------------------------------------
// Synchro PPPoE : chaque MikroTik appelle cette adresse et reçoit, pour SON
// serveur, quoi faire sur ses comptes. Lecture seule côté routeurs — cette
// fonction ne touche JAMAIS aux MikroTik ; c'est le script (pppoe-sync.rsc)
// qui applique localement.
//
//   Appel : GET /api/pppoe-sync?serveur=V6&token=SECRET
//                [&comptes=NOM,...]  (comptes actifs du routeur, pour l'import)
//                [&actifs=NOM,...]   (comptes CONNECTÉS maintenant, pour le suivi)
//   Auth  : token partagé = variable d'environnement PPPOE_SYNC_SECRET (Vercel).
//
//   Réponse (texte simple, une ligne par compte) :
//     #APESPOT V6 42        <- marqueur de validité + nombre de lignes
//     E BADAMELI            <- E = activer (client à jour)
//     D GOUDO               <- D = couper (échéance dépassée)
//     X VIEUX               <- X = supprimer (compte inactif depuis 3 mois)
//
// Rapprochement par le NOM (login PPPoE = nom du client ; le champ pppoe_login
// de la fiche prime s'il est rempli). Noms uniques dans APESPOT = clé fiable.
//
// PHASE 3 — remontée auto des comptes (`comptes`) : crée les comptes inconnus,
// SANS date (ni coupés ni activés tant que l'admin n'a pas mis de date).
//
// SUPPRESSION AUTO — on NE lit PAS la date de dernière connexion du routeur
// (format peu fiable entre v6/v7). À la place, APESPOT note lui-même quand il
// voit un compte CONNECTÉ (`actifs`). Un compte jamais vu connecté depuis 3
// mois (et suivi depuis au moins 3 mois) devient « X » (à supprimer). La
// suppression réelle est décidée côté routeur (interrupteur séparé + mode test).
// ---------------------------------------------------------------------------

import { SUPABASE_URL, sbHeaders, envError } from "./_lib.js";

const MAX_IMPORT = 100;                  // garde-fou import : max 100 créations/appel.
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
function liste(s) {
  return new Set(String(s || "").split(",").map(normNom).filter(Boolean));
}

export default async (req, res) => {
  const err = envError();
  if (err) return res.status(500).send("# " + err);
  const SECRET = process.env.PPPOE_SYNC_SECRET;
  if (!SECRET) return res.status(500).send("# PPPOE_SYNC_SECRET manquante sur Vercel.");

  const q = req.query || {};
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers["authorization"] || "");
  const token = q.token || (bearer ? bearer[1].trim() : null);
  const serveur = normServeur(q.serveur);
  if (!serveur) return res.status(400).send("# parametre 'serveur' manquant");
  if (!token || token !== SECRET) return res.status(401).send("# token invalide");

  // Petit utilitaire de mise à jour (par liste d'id), sans casser la synchro.
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
      `${SUPABASE_URL}/rest/v1/wifi_clients?select=id,nom,serveur,pppoe_login,date_exp,derniere_connexion_vue,suivi_depuis`,
      { headers: sbHeaders({ Accept: "application/json" }) }
    );
    if (!upstream.ok) return res.status(502).send("# erreur base");
    const clients = await upstream.json();

    const connus = new Set();
    for (const c of clients) {
      const n = normNom(c.nom); if (n) connus.add(n);
      const p = normNom(c.pppoe_login); if (p) connus.add(p);
    }

    // ---- PHASE 3 : créer les comptes inconnus remontés par le routeur -------
    if (typeof q.comptes === "string" && q.comptes) {
      const vus = new Set();
      const aCreer = [];
      for (const raw of q.comptes.split(",")) {
        const login = raw.trim();
        if (!login) continue;
        const clef = normNom(login);
        if (!clef || connus.has(clef) || vus.has(clef)) continue;
        vus.add(clef);
        aCreer.push({ nom: login, serveur: `SERVEUR ${serveur}`, date_exp: null, pppoe_login: null });
        connus.add(clef);
        if (aCreer.length >= MAX_IMPORT) break;
      }
      if (aCreer.length > 0) {
        try {
          await fetch(`${SUPABASE_URL}/rest/v1/wifi_clients`, {
            method: "POST",
            headers: sbHeaders({ "Content-Type": "application/json", Prefer: "return=minimal" }),
            body: JSON.stringify(aCreer),
          });
        } catch (e) { console.error("PPPoE import:", e); }
      }
    }

    // ---- Clients de CE serveur + suivi des connexions -----------------------
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const connectes = liste(q.actifs);        // comptes connectés maintenant
    const duServeur = clients.filter((c) => normServeur(c.serveur) === serveur);

    const idsSuiviNull = [];                   // démarrer le suivi (3 mois de recul)
    const idsVus = [];                         // vu connecté => tampon "maintenant"
    for (const c of duServeur) {
      if (!c.suivi_depuis) idsSuiviNull.push(c.id);
      const login = normNom(c.pppoe_login || c.nom);
      if (login && connectes.has(login)) idsVus.push(c.id);
    }
    await patch(idsSuiviNull, { suivi_depuis: nowIso });
    await patch(idsVus, { derniere_connexion_vue: nowIso });

    // ---- Construire la liste d'ordres (E / D / X) ---------------------------
    const lignes = [];
    for (const c of duServeur) {
      const login = normNom(c.pppoe_login || c.nom);
      if (!login) continue;

      // Suppression : jamais si connecté maintenant ; il faut un suivi d'au
      // moins 3 mois ET aucune connexion vue depuis 3 mois.
      const suiviMs = c.suivi_depuis ? new Date(c.suivi_depuis).getTime() : nowMs;
      const vuMs = c.derniere_connexion_vue ? new Date(c.derniere_connexion_vue).getTime() : null;
      const suiviAssezLong = (nowMs - suiviMs) > MS_3_MOIS;
      const pasVuDepuis3Mois = (vuMs === null) || ((nowMs - vuMs) > MS_3_MOIS);
      if (!connectes.has(login) && suiviAssezLong && pasVuDepuis3Mois) {
        lignes.push(`X ${login}`);
        continue;                              // supprimer prime sur couper/activer
      }

      const j = joursAvant(c.date_exp);
      if (j === null) continue;                // pas de date -> on ne touche pas
      lignes.push(`${j <= 0 ? "D" : "E"} ${login}`);
    }

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(`#APESPOT ${serveur} ${lignes.length}\n${lignes.join("\n")}\n`);
  } catch (e) {
    console.error(e);
    return res.status(502).send("# erreur serveur");
  }
};
