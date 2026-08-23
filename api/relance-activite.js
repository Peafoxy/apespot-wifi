// api/relance-activite.js
// Relance automatique : rappelle au personnel qu'il reste du travail en attente
// (paiements à valider, demandes clients, abonnements à renouveler) TANT QUE
// personne n'a ouvert l'application. Pensé pour être appelé toutes les 10 min.
//
// Déclenchement :
//   - GET ?cle=<RELANCE_CRON_SECRET>  → par le planificateur (Supabase pg_cron
//     ou cron Vercel). Le secret empêche un tiers de déclencher des envois.
//   - GET/POST avec une session personnel valide → test manuel depuis l'app.
//
// N'envoie RIEN si : hors plage horaire (journée), quelqu'un a été actif dans
// l'app il y a moins de 10 min (présence), ou il n'y a aucun élément en attente.

import webpush from "web-push";
import { SUPABASE_URL, sbHeaders, getSession, envError } from "./_lib.js";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const RELANCE_CRON_SECRET = process.env.RELANCE_CRON_SECRET;

// Plage horaire — heure de Lomé = UTC+0, sans changement d'heure saisonnier.
const HEURE_DEBUT = 7; // à partir de 07h
const HEURE_FIN = 21; // jusqu'à 21h (exclus)
// On considère que « quelqu'un regarde » si l'app a été active il y a moins que ça.
const FENETRE_PRESENCE_MS = 10 * 60 * 1000;
// Abonnements « à surveiller » : expirés, ou expirant sous ce nombre de jours.
const JOURS_AVANT_EXPIRATION = 2;

// Compte les lignes d'un filtre PostgREST via l'en-tête Content-Range
// (Prefer: count=exact), sans rapatrier les lignes elles-mêmes.
async function compter(cheminFiltre) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${cheminFiltre}`, {
    headers: sbHeaders({ Prefer: "count=exact", Range: "0-0" }),
  });
  const cr = res.headers.get("content-range") || "";
  const total = cr.split("/")[1];
  return total && total !== "*" ? parseInt(total, 10) : 0;
}

export default async (req, res) => {
  const err = envError();
  if (err) {
    res.status(500).json({ ok: false, error: err });
    return;
  }
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    res.status(500).json({ ok: false, error: "Clés VAPID manquantes sur Vercel." });
    return;
  }

  // Autorisation : le secret du planificateur, ou une session personnel valide.
  const cle = (req.query && req.query.cle) || "";
  const session = getSession(req);
  const autoriseParSecret = RELANCE_CRON_SECRET && cle === RELANCE_CRON_SECRET;
  if (!autoriseParSecret && !session) {
    res.status(401).json({ ok: false, error: "Non autorisé." });
    return;
  }

  const maintenant = new Date();
  const heure = maintenant.getUTCHours();
  if (heure < HEURE_DEBUT || heure >= HEURE_FIN) {
    res.status(200).json({ ok: true, envoye: false, raison: "hors_horaire" });
    return;
  }

  try {
    // 1) Présence : quelqu'un a-t-il eu l'app ouverte récemment ?
    const presRes = await fetch(
      `${SUPABASE_URL}/rest/v1/wifi_presence?id=eq.1&select=last_seen_at`,
      { headers: sbHeaders() }
    );
    const presArr = await presRes.json().catch(() => []);
    const lastSeen =
      Array.isArray(presArr) && presArr[0] && presArr[0].last_seen_at
        ? new Date(presArr[0].last_seen_at).getTime()
        : 0;
    if (lastSeen && maintenant.getTime() - lastSeen < FENETRE_PRESENCE_MS) {
      res.status(200).json({ ok: true, envoye: false, raison: "personnel_present" });
      return;
    }

    // 2) Éléments en attente d'un traitement du personnel.
    const limiteExpiration = new Date(
      maintenant.getTime() + JOURS_AVANT_EXPIRATION * 86400000
    )
      .toISOString()
      .slice(0, 10); // AAAA-MM-JJ
    const [paiements, tickets, reclamations, expires] = await Promise.all([
      compter("wifi_payment_requests?status=eq.pending"),
      compter("wifi_ticket_requests?status=eq.pending"),
      compter("wifi_complaints?status=eq.nouveau"),
      // date_exp est une date ISO "AAAA-MM-JJ" ; la borne basse écarte les
      // valeurs vides/aberrantes qui, en comparaison texte, passeraient <= limite.
      compter(
        `wifi_clients?date_exp=gte.2000-01-01&date_exp=lte.${limiteExpiration}`
      ),
    ]);

    const parties = [];
    if (paiements) parties.push(`${paiements} paiement${paiements > 1 ? "s" : ""} à valider`);
    if (reclamations) parties.push(`${reclamations} réclamation${reclamations > 1 ? "s" : ""}`);
    if (tickets) parties.push(`${tickets} demande${tickets > 1 ? "s" : ""} de ticket`);
    if (expires) parties.push(`${expires} abonnement${expires > 1 ? "s" : ""} à renouveler`);

    if (parties.length === 0) {
      res.status(200).json({ ok: true, envoye: false, raison: "rien_en_attente" });
      return;
    }

    // 3) Envoi de la notification à tout le personnel abonné.
    webpush.setVapidDetails(
      "mailto:contact@apespot-wifi.local",
      VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY
    );
    const listRes = await fetch(
      `${SUPABASE_URL}/rest/v1/wifi_push_subscriptions?select=*`,
      { headers: sbHeaders() }
    );
    const subs = (await listRes.json().catch(() => [])) || [];
    const payload = JSON.stringify({
      title: "APESPOT — en attente",
      body: parties.join(" · "),
      url: "/",
    });

    const results = await Promise.allSettled(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload
          );
        } catch (e2) {
          // Abonnement expiré / désinstallé : on le retire proprement.
          if (e2.statusCode === 404 || e2.statusCode === 410) {
            await fetch(
              `${SUPABASE_URL}/rest/v1/wifi_push_subscriptions?id=eq.${s.id}`,
              { method: "DELETE", headers: sbHeaders() }
            );
          }
          throw e2;
        }
      })
    );

    const sent = results.filter((r) => r.status === "fulfilled").length;
    res.status(200).json({
      ok: true,
      envoye: true,
      sent,
      total: subs.length,
      counts: { paiements, tickets, reclamations, expires },
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
};
