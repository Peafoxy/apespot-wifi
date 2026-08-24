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
// Rappels WhatsApp : notre rôle n'est pas de renouveler (c'est le client), mais
// d'ENVOYER le rappel WhatsApp aux clients dont l'échéance approche. On les
// compte tant qu'ils sont dans la fenêtre « à notifier » AVANT l'expiration
// (échéance entre aujourd'hui et +N jours) ET pas encore relancés aujourd'hui.
// Une fois expirés, plus de rappel automatique (libre à l'administration).
const JOURS_FENETRE_RELANCE = 4;
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
    const aujourdHui = jour(0);
    const finFenetre = jour(JOURS_FENETRE_RELANCE * 86400000);
    // Clients à relancer par WhatsApp = échéance dans la fenêtre (aujourd'hui →
    // +N j, donc AVANT expiration) ET pas encore relancés aujourd'hui
    // (relance_le). Repli si la colonne relance_le n'existe pas encore : on
    // compte la fenêtre sans le filtre du jour (dégradation propre avant migration).
    const compterRelance = async () => {
      try {
        return await compter(
          `wifi_clients?date_exp=gte.${aujourdHui}&date_exp=lte.${finFenetre}` +
          `&or=(relance_le.is.null,relance_le.lt.${aujourdHui})`
        );
      } catch {
        return await compter(`wifi_clients?date_exp=gte.${aujourdHui}&date_exp=lte.${finFenetre}`);
      }
    };
    const [paiements, tickets, reclamations, aRelancer] = await Promise.all([
      compter("wifi_payment_requests?status=eq.pending"),
      compter("wifi_ticket_requests?status=eq.pending"),
      compter("wifi_complaints?status=eq.nouveau"),
      compterRelance(),
    ]);

    const parties = [];
    if (paiements) parties.push(`${paiements} paiement${paiements > 1 ? "s" : ""} à valider`);
    if (reclamations) parties.push(`${reclamations} réclamation${reclamations > 1 ? "s" : ""}`);
    if (tickets) parties.push(`${tickets} demande${tickets > 1 ? "s" : ""} de ticket`);
    if (aRelancer) parties.push(`${aRelancer} rappel${aRelancer > 1 ? "s" : ""} WhatsApp à envoyer`);

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
      counts: { paiements, tickets, reclamations, aRelancer },
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
};
