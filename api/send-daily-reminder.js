// api/send-daily-reminder.js
// Fonction serveur Vercel — envoie une notification à tous les appareils abonnés.
// - Déclenchée automatiquement par vercel.json (cron), une fois par jour à 8h (GET, message par défaut).
// - Peut aussi être déclenchée depuis l'application (POST, message personnalisé) :
//   nécessite un jeton de session valide (délivré par /api/login) — l'ancien
//   code secret partagé, qui était visible dans le code du navigateur, a été retiré.

import webpush from "web-push";
import { getSession } from "./_lib.js";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
// Le RLS étant activé sur wifi_push_subscriptions, il faut la clé service_role
// pour lire les abonnements (la clé anon ne fonctionne plus).
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
// Clé JWT ("eyJ...") → apikey + Authorization ; nouvelle clé (sb_secret_...) → apikey seul.
const SB_HEADERS = SUPABASE_KEY && SUPABASE_KEY.startsWith("eyJ")
  ? { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
  : { apikey: SUPABASE_KEY };

export default async (req, res) => {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !SUPABASE_URL || !SUPABASE_KEY) {
    res.status(500).json({ ok: false, error: "Variables d'environnement manquantes sur Vercel." });
    return;
  }

  let title = "APESPOT WI-FI";
  let body = "N'oublie pas de consulter l'application aujourd'hui.";
  let audience = "all"; // all | admin | technicien

  // Envoi manuel ou déclenché par un événement de l'app (nouvelle réclamation,
  // nouveau paiement...) : réservé aux utilisateurs connectés.
  if (req.method === "POST") {
    const session = getSession(req);
    if (!session) {
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
      headers: SB_HEADERS,
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
              headers: SB_HEADERS,
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
