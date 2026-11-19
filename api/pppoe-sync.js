// api/pppoe-sync.js
// ---------------------------------------------------------------------------
// Synchro PPPoE : chaque MikroTik appelle cette adresse et reçoit, pour SON
// serveur, la liste des comptes à ACTIVER (clients à jour) et à COUPER
// (expirés). Lecture seule côté routeurs — cette fonction ne touche JAMAIS aux
// MikroTik ; c'est le script (mikrotik/pppoe-sync.rsc) qui applique localement.
//
//   Appel : GET /api/pppoe-sync?serveur=V6&token=SECRET[&comptes=NOM1,NOM2,...]
//   Auth  : token partagé = variable d'environnement PPPOE_SYNC_SECRET (Vercel).
//
//   Réponse (texte simple, une ligne par compte) :
//     #APESPOT V6 42        <- marqueur de validité + nombre de lignes
//     E BADAMELI            <- E = activer (client à jour)
//     D GOUDO               <- D = couper (échéance dépassée)
//
// Rapprochement par le NOM (login PPPoE = nom du client ; le champ pppoe_login
// de la fiche prime s'il est rempli). Les noms étant uniques dans APESPOT, la
// clé est fiable.
//
// PHASE 3 — remontée automatique des comptes : si le routeur envoie la liste de
// ses comptes (paramètre `comptes`), tout compte INCONNU d'APESPOT est créé
// automatiquement — SANS date d'échéance (date_exp = null). Il apparaît alors
// dans l'app « à compléter » ; l'admin lui met sa date (le site propose +1 mois).
// Tant qu'il n'a pas de date, il n'est NI coupé NI activé : aucune mauvaise date
// n'est jamais écrite.
// ---------------------------------------------------------------------------

import { SUPABASE_URL, sbHeaders, envError } from "./_lib.js";

const MAX_IMPORT = 100; // garde-fou : au plus 100 créations par appel.

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

    // Ensemble des noms déjà connus (nom OU pppoe_login), pour le rapprochement.
    const connus = new Set();
    for (const c of clients) {
      const n = normNom(c.nom);
      if (n) connus.add(n);
      const p = normNom(c.pppoe_login);
      if (p) connus.add(p);
    }

    // ---- PHASE 3 : créer les comptes inconnus remontés par le routeur -------
    // (uniquement si le routeur envoie `comptes`, ce qu'il fait en mode réel).
    const brut = typeof q.comptes === "string" ? q.comptes : "";
    if (brut) {
      const vus = new Set();
      const aCreer = [];
      for (const raw of brut.split(",")) {
        const login = raw.trim();
        if (!login) continue;
        const clef = normNom(login);
        if (!clef || connus.has(clef) || vus.has(clef)) continue; // déjà connu / doublon
        vus.add(clef);
        aCreer.push({ nom: login, serveur: `SERVEUR ${serveur}`, date_exp: null, pppoe_login: null });
        connus.add(clef); // pour que le compte compte comme connu ci-dessous
        if (aCreer.length >= MAX_IMPORT) break;
      }
      if (aCreer.length > 0) {
        try {
          await fetch(`${SUPABASE_URL}/rest/v1/wifi_clients`, {
            method: "POST",
            headers: sbHeaders({ "Content-Type": "application/json", Prefer: "return=minimal" }),
            body: JSON.stringify(aCreer),
          });
        } catch (e) {
          console.error("PPPoE import:", e); // on n'interrompt pas la synchro de coupure
        }
      }
    }

    // ---- Liste « activer / couper » pour ce serveur -------------------------
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
