// api/pppoe-sync.js
// ---------------------------------------------------------------------------
// Synchro PPPoE : chaque MikroTik appelle cette adresse et reçoit, pour SON
// serveur, la liste des comptes à ACTIVER (clients à jour) et à COUPER
// (expirés). Lecture seule — cette fonction ne touche JAMAIS aux routeurs ;
// c'est le script MikroTik (mikrotik/pppoe-sync.rsc) qui applique localement.
//
//   Appel : GET /api/pppoe-sync?serveur=V6&token=SECRET
//   Auth  : token partagé = variable d'environnement PPPOE_SYNC_SECRET (Vercel).
//
//   Réponse (texte simple, une ligne par compte) :
//     #APESPOT V6 42        <- marqueur de validité + nombre de lignes
//     E BADAMELI            <- E = activer (client à jour)
//     D GOUDO               <- D = couper (échéance dépassée)
//
// Le rapprochement se fait par le NOM : le login PPPoE sur le routeur = le nom
// du client (ex. KOFFI). Si un client a un login différent, on renseigne le
// champ « Login PPPoE » dans sa fiche (colonne pppoe_login) et c'est lui qui
// prime. Les noms des clients étant uniques dans APESPOT, la clé est fiable.
// ---------------------------------------------------------------------------

import { SUPABASE_URL, sbHeaders, envError } from "./_lib.js";

// "SERVEUR V6" / "serveur v6" / "V6" -> "V6" ; "SERVEUR H2" / "H2" -> "H2".
function normServeur(s) {
  return String(s || "").toUpperCase().replace(/SERVEUR/g, "").replace(/[^A-Z0-9]/g, "");
}

// Nom -> clé de rapprochement : majuscules, sans accents, sans espaces de bord.
function normNom(s) {
  return String(s || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

// Jours avant l'échéance (négatif = déjà dépassée). Même calcul que l'app.
function joursAvant(dateExp) {
  if (!dateExp) return null;
  const exp = new Date(dateExp + "T00:00:00");
  if (isNaN(exp.getTime())) return null;
  const now = new Date();
  const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((exp - todayMid) / 86400000);
}

export default async (req, res) => {
  const err = envError();
  if (err) return res.status(500).send("# " + err);

  const SECRET = process.env.PPPOE_SYNC_SECRET;
  if (!SECRET) return res.status(500).send("# PPPOE_SYNC_SECRET manquante sur Vercel.");

  const q = req.query || {};
  const authHeader = req.headers["authorization"] || "";
  const bearer = /^Bearer\s+(.+)$/i.exec(authHeader);
  const token = q.token || (bearer ? bearer[1].trim() : null);
  const serveur = normServeur(q.serveur);

  if (!serveur) return res.status(400).send("# parametre 'serveur' manquant");
  if (!token || token !== SECRET) return res.status(401).send("# token invalide");

  try {
    const upstream = await fetch(
      `${SUPABASE_URL}/rest/v1/wifi_clients?select=nom,serveur,pppoe_login,date_exp`,
      { headers: sbHeaders({ Accept: "application/json" }) }
    );
    if (!upstream.ok) return res.status(502).send("# erreur base");
    const clients = await upstream.json();

    const lignes = [];
    for (const c of clients) {
      if (normServeur(c.serveur) !== serveur) continue;     // pas ce serveur
      const login = normNom(c.pppoe_login || c.nom);         // login = pppoe_login sinon nom
      if (!login) continue;
      const j = joursAvant(c.date_exp);
      if (j === null) continue;                              // pas de date -> on ne touche pas
      // Règle identique à l'app (computeStatus) : échéance aujourd'hui ou
      // dépassée (jours <= 0) = À COUPER ; sinon on garde actif.
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
