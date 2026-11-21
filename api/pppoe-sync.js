// api/pppoe-sync.js
// ---------------------------------------------------------------------------
// Synchro PPPoE. Chaque MikroTik interroge le site pour SON serveur (étiquette
// V6/V11/V12/H2) et reçoit la liste des décisions pour les clients de CE
// serveur : E (activer), D (couper), X (supprimer). Le routeur applique ensuite
// à ses comptes (il cherche chaque nom dans ses « secrets »).
//
//   Appel : GET /api/pppoe-sync?serveur=V11&token=SECRET
//   Auth  : token partagé = variable d'environnement PPPOE_SYNC_SECRET (Vercel).
//
//   Réponse :
//     #APESPOT V11 11
//     E KOUWODO
//     D GOUDO
//
// Lecture seule — cette fonction ne touche jamais aux routeurs ; c'est le
// script (pppoe-sync.rsc) qui applique localement. Requête ET réponse courtes
// (seulement les clients du serveur demandé) -> aucun risque de timeout.
//
// NB : l'import automatique des comptes manquants et la mesure des connexions
// (pour la suppression) se feront via une autre voie — ils nécessitent que le
// routeur envoie SA liste. La règle X reste prête ici (dormant tant que le
// suivi des connexions n'est pas alimenté).
// ---------------------------------------------------------------------------

import { SUPABASE_URL, sbHeaders, envError } from "./_lib.js";

const MS_3_MOIS = 90 * 24 * 60 * 60 * 1000;

// "SERVEUR V6" / "serveur v6" / "V6" -> "V6" ; "SERVEUR H2" / "H2" -> "H2".
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

  const q = req.query || {};
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers["authorization"] || "");
  const token = q.token || (bearer ? bearer[1].trim() : null);
  const serveur = normServeur(q.serveur);
  if (!serveur) return res.status(400).send("# parametre 'serveur' manquant");
  if (!token || token !== SECRET) return res.status(401).send("# token invalide");

  try {
    // Optimisation egress : on ne récupère QUE les clients de CE serveur, au lieu
    // de toute la table à chaque appel (÷ ~4 sur une base partagée par 3 apps).
    // `serveur` est déjà normalisé en [A-Z0-9] (ex. "V11") -> aucune injection.
    // Le filtre couvre le format standard « SERVEUR V11 » ET un éventuel « V11 »
    // seul ; le garde-fou JS (normServeur) refiltre ensuite au cas où.
    const filtreServeur = `or=(serveur.ilike.SERVEUR*${serveur},serveur.ilike.${serveur})`;
    const upstream = await fetch(
      `${SUPABASE_URL}/rest/v1/wifi_clients?select=nom,serveur,pppoe_login,date_exp,derniere_connexion_vue,suivi_depuis&${filtreServeur}`,
      { headers: sbHeaders({ Accept: "application/json" }) }
    );
    if (!upstream.ok) return res.status(502).send("# erreur base");
    const clients = await upstream.json();

    const nowMs = Date.now();
    const vus = new Set();
    const lignes = [];
    for (const c of clients) {
      if (normServeur(c.serveur) !== serveur) continue;   // seulement CE serveur
      const login = normNom(c.pppoe_login || c.nom);
      if (!login || vus.has(login)) continue;
      vus.add(login);

      // Suppression (dormant tant que le suivi n'est pas alimenté).
      const suiviMs = c.suivi_depuis ? new Date(c.suivi_depuis).getTime() : null;
      const vuMs = c.derniere_connexion_vue ? new Date(c.derniere_connexion_vue).getTime() : null;
      if (suiviMs && (nowMs - suiviMs) > MS_3_MOIS && (vuMs === null || (nowMs - vuMs) > MS_3_MOIS)) {
        lignes.push(`X ${login}`);
        continue;
      }
      const j = joursAvant(c.date_exp);
      if (j === null) continue;                            // pas de date -> on ne touche pas
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
