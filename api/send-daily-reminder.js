// api/send-daily-reminder.js
// Fonction serveur Vercel — envoie une notification à tous les appareils abonnés.
// - Déclenchée automatiquement par vercel.json (cron), une fois par jour à 8h (GET, message par défaut).
// - Peut aussi être déclenchée manuellement par l'administrateur principal (POST, message personnalisé,
//   protégé par un code secret pour éviter tout envoi non autorisé).

import webpush from "web-push";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const ADMIN_NOTIFY_SECRET = process.env.ADMIN_NOTIFY_SECRET;

export default async (req, res) => {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
    res.status(500).json({ ok: false, error: "Variables d'environnement manquantes sur Vercel." });
    return;
  }

  let title = "APESPOT WI-FI";
  let body = "N'oublie pas de consulter l'application aujourd'hui.";
  let audience = "all"; // all | admin | technicien

  // Envoi manuel ou déclenché par un événement de l'app (nouvelle réclamation, nouveau paiement...) :
  // nécessite le code secret, permet un message personnalisé et un public restreint.
  if (req.method === "POST") {
    const provided = req.headers["x-admin-secret"];
    if (!ADMIN_NOTIFY_SECRET || provided !== ADMIN_NOTIFY_SECRET) {
      res.status(401).json({ ok: false, error: "Non autorisé." });
      return;
    }
    if (req.body && req.body.title) title = String(req.body.title).slice(0, 100);
    if (req.body && req.body.body) body = String(req.body.body).slice(0, 500);
    if (req.body && (req.body.audience === "admin" || req.body.audience === "technicien")) {
      audience = req.body.audience;
    }
  }

  webpush.setVapidDetails("mailto:contact@apespot-wifi.local", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  try {
    const listRes = await fetch(`${SUPABASE_URL}/rest/v1/wifi_push_subscriptions?select=*`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    });
    let subs = await listRes.json();
    if (audience !== "all") {
      subs = (subs || []).filter((s) => s.role === audience);
    }

    const payload = JSON.stringify({ title, body, url: "/" });

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
