// api/send-daily-reminder.js
// Fonction serveur Vercel — envoie la notification quotidienne de 8h à tous les appareils abonnés.
// Déclenchée automatiquement par vercel.json (cron), une fois par jour.

const webpush = require("web-push");

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

module.exports = async (req, res) => {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
    res.status(500).json({ ok: false, error: "Variables d'environnement manquantes sur Vercel." });
    return;
  }

  webpush.setVapidDetails("mailto:contact@apespot-wifi.local", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  try {
    const listRes = await fetch(`${SUPABASE_URL}/rest/v1/wifi_push_subscriptions?select=*`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    });
    const subs = await listRes.json();

    const payload = JSON.stringify({
      title: "APESPOT WI-FI",
      body: "N'oublie pas de consulter l'application aujourd'hui.",
      url: "/",
    });

    const results = await Promise.allSettled(
      (subs || []).map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload
          );
        } catch (err) {
          // Abonnement expiré ou désinstallé : on le retire proprement de la base.
          if (err.statusCode === 404 || err.statusCode === 410) {
            await fetch(`${SUPABASE_URL}/rest/v1/wifi_push_subscriptions?id=eq.${s.id}`, {
              method: "DELETE",
              headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
            });
          }
          throw err;
        }
      })
    );

    const sent = results.filter((r) => r.status === "fulfilled").length;
    res.status(200).json({ ok: true, sent, total: (subs || []).length });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
};
