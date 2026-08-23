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
// l'app il y a moins de 10 min (présence), une relance vient déjà d'être envoyée
// (anti-répétition), ou il n'y a aucun élément réellement en attente.

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
// Abonnements « à surveiller » : ceux qui expirent bientôt (sous ce nb de jours)
// OU qui viennent d'expirer (dans les JOURS_APRES_EXPIRATION derniers jours).
// On NE compte PAS les clients coupés depuis longtemps : sinon le rappel ne
// s'éteindrait jamais (un vieux client jamais renouvelé le maintiendrait actif).
const JOURS_AVANT_EXPIRATION = 2;
const JOURS_APRES_EXPIRATION = 7;
// Anti-répétition : pas deux relances à moins de X l'une de l'autre, même si
// l'endpoint est appelé plusieurs fois dans la fenêtre (double planificateur,
// appels répétés). < 10 min pour ne pas gêner la cadence normale du cron.
const FENETRE_ANTI_REPETITION_MS = 9 * 60 * 1000;

// Compte les lignes d'un filtre PostgREST via l'en-tête Content-Range
// (Prefer: count=exact), sans rapatrier les lignes elles-mêmes.
async function compter(cheminFiltre) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${cheminFiltre}`, {
    headers: sbHeaders({ Prefer: "count=exact", Range: "0-0" }),
  });
  // On NE silencie PAS une erreur : sans ce contrôle, une clé invalide ou une
  // erreur PostgREST renvoyait 0 partout → « rien en attente » → aucune relance,
  // sans le moindre signal. On lève l'erreur pour qu'elle remonte (500 visible
  // au test manuel), au lieu d'une panne silencieuse.
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Comptage ${cheminFiltre} — ${res.status} ${txt}`);
  }
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

  // Autorisation « fail-closed » : il faut soit le bon secret de planificateur,
  // soit une session personnel valide (test manuel). On NE laisse PLUS l'endpoint
  // ouvert quand le secret n'est pas configuré — sans quoi un tiers pourrait
  // déclencher des notifications en boucle vers le personnel.
  const cle = (req.query && req.query.cle) || "";
  const session = getSession(req);
  const autorise = (RELANCE_CRON_SECRET && cle === RELANCE_CRON_SECRET) || Boolean(session);
  if (!autorise) {
    res.status(401).json({
      ok: false,
      error: RELANCE_CRON_SECRET
        ? "Non autorisé."
        : "Non configuré : définir RELANCE_CRON_SECRET sur Vercel.",
    });
    return;
  }

  const maintenant = new Date();
  const heure = maintenant.getUTCHours();
  if (heure < HEURE_DEBUT || heure >= HEURE_FIN) {
    res.status(200).json({ ok: true, envoye: false, raison: "hors_horaire" });
    return;
  }

  try {
    // 1) Présence : quelqu'un a-t-il eu l'app ouverte récemment ? Et quand a-t-on
    //    relancé pour la dernière fois (anti-répétition) ? On lit `*` pour rester
    //    tolérant si la colonne derniere_relance_at n'est pas encore ajoutée.
    const presRes = await fetch(
      `${SUPABASE_URL}/rest/v1/wifi_presence?id=eq.1&select=*`,
      { headers: sbHeaders() }
    );
    const presArr = await presRes.json().catch(() => []);
    const presence = Array.isArray(presArr) && presArr[0] ? presArr[0] : {};
    const lastSeen = presence.last_seen_at ? new Date(presence.last_seen_at).getTime() : 0;
    if (lastSeen && maintenant.getTime() - lastSeen < FENETRE_PRESENCE_MS) {
      res.status(200).json({ ok: true, envoye: false, raison: "personnel_present" });
      return;
    }
    const derniereRelance = presence.derniere_relance_at
      ? new Date(presence.derniere_relance_at).getTime()
      : 0;
    if (derniereRelance && maintenant.getTime() - derniereRelance < FENETRE_ANTI_REPETITION_MS) {
      res.status(200).json({ ok: true, envoye: false, raison: "relance_recente" });
      return;
    }

    // 2) Éléments en attente d'un traitement du personnel.
    const jour = (decalageMs) =>
      new Date(maintenant.getTime() + decalageMs).toISOString().slice(0, 10); // AAAA-MM-JJ
    const borneHaute = jour(JOURS_AVANT_EXPIRATION * 86400000); // expire bientôt
    const borneBasse = jour(-JOURS_APRES_EXPIRATION * 86400000); // vient d'expirer
    const [paiements, tickets, reclamations, expires] = await Promise.all([
      compter("wifi_payment_requests?status=eq.pending"),
      compter("wifi_ticket_requests?status=eq.pending"),
      compter("wifi_complaints?status=eq.nouveau"),
      // Fenêtre ACTIONNABLE seulement : expirant sous 2 j, ou expiré depuis moins
      // de 7 j. La borne basse écarte aussi les date_exp vides/aberrantes. Un
      // client coupé depuis longtemps ne relance donc plus indéfiniment.
      compter(
        `wifi_clients?date_exp=gte.${borneBasse}&date_exp=lte.${borneHaute}`
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
    // Personnel uniquement (défensif : seul le personnel s'abonne aujourd'hui,
    // mais on évite ainsi de pousser des comptes internes vers un client si un
    // abonnement client apparaissait un jour).
    const listRes = await fetch(
      `${SUPABASE_URL}/rest/v1/wifi_push_subscriptions?select=*&role=in.(admin,technicien)`,
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

    // Mémorise l'heure de cette relance (anti-répétition). Best-effort : si la
    // colonne derniere_relance_at n'existe pas encore (migration non appliquée),
    // on ignore l'erreur — la relance fonctionne, seul l'anti-répétition attend.
    await fetch(`${SUPABASE_URL}/rest/v1/wifi_presence?id=eq.1`, {
      method: "PATCH",
      headers: sbHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify({ derniere_relance_at: maintenant.toISOString() }),
    }).catch(() => {});

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
