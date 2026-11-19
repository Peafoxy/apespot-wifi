// api/pppoe-sync.js
// ---------------------------------------------------------------------------
// Synchro PPPoE. Le site renvoie, pour TOUS les clients, l'action à faire par
// le NOM : E (activer), D (couper), X (supprimer). Chaque MikroTik télécharge
// cette liste et n'applique qu'aux comptes qu'il possède (il cherche chaque nom
// dans ses propres « secrets »). Ainsi chaque routeur gère exactement ses
// comptes, quelle que soit la répartition — et la REQUÊTE reste très courte
// (juste le token), donc aucun risque de timeout même avec beaucoup de comptes.
//
//   Appel : GET /api/pppoe-sync?serveur=V11&token=SECRET
//   Auth  : token partagé = variable d'environnement PPPOE_SYNC_SECRET (Vercel).
//
//   Réponse :
//     #APESPOT ALL 142
//     E BADAMELI
//     D GOUDO
//     X VIEUX
//
// Lecture seule — cette fonction ne touche jamais aux routeurs ; c'est le
// script (pppoe-sync.rsc) qui applique localement.
//
// NB : l'import automatique des comptes manquants et la mesure des connexions
// (pour la suppression) se font via une autre voie (à venir), car ils
// nécessitent que le routeur envoie SA liste — ce qui est traité séparément.
// La règle X reste gérée ici : si le suivi indique un compte inactif 3 mois,
// il sort en X (dormant tant que le suivi n'est pas alimenté).
// ---------------------------------------------------------------------------

import { SUPABASE_URL, sbHeaders, envError } from "./_lib.js";

const MS_3_MOIS = 90 * 24 * 60 * 60 * 1000;

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

  const q = req.query || {};
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers["authorization"] || "");
  const token = q.token || (bearer ? bearer[1].trim() : null);
  if (!token || token !== SECRET) return res.status(401).send("# token invalide");

  try {
    const upstream = await fetch(
      `${SUPABASE_URL}/rest/v1/wifi_clients?select=nom,pppoe_login,date_exp,derniere_connexion_vue,suivi_depuis`,
      { headers: sbHeaders({ Accept: "application/json" }) }
    );
    if (!upstream.ok) return res.status(502).send("# erreur base");
    const clients = await upstream.json();

    const nowMs = Date.now();
    const vus = new Set();
    const lignes = [];
    for (const c of clients) {
      const login = normNom(c.pppoe_login || c.nom);
      if (!login || vus.has(login)) continue;         // vide ou doublon
      vus.add(login);

      // Suppression (dormant tant que le suivi n'est pas alimenté) : suivi d'au
      // moins 3 mois ET pas vu connecté depuis 3 mois.
      const suiviMs = c.suivi_depuis ? new Date(c.suivi_depuis).getTime() : null;
      const vuMs = c.derniere_connexion_vue ? new Date(c.derniere_connexion_vue).getTime() : null;
      if (suiviMs && (nowMs - suiviMs) > MS_3_MOIS && (vuMs === null || (nowMs - vuMs) > MS_3_MOIS)) {
        lignes.push(`X ${login}`);
        continue;
      }
      const j = joursAvant(c.date_exp);
      if (j === null) continue;                        // pas de date -> on ne touche pas
      lignes.push(`${j <= 0 ? "D" : "E"} ${login}`);
    }

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(`#APESPOT ALL ${lignes.length}\n${lignes.join("\n")}\n`);
  } catch (e) {
    console.error(e);
    return res.status(502).send("# erreur serveur");
  }
};
