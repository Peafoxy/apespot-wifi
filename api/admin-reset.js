// api/admin-reset.js — ENDPOINT TEMPORAIRE (jamais fusionné sur main).
// Marque comme "accepted" les demandes de paiement EN ATTENTE d'un client déjà
// réabonné (orphelines d'avant le correctif). À SUPPRIMER après usage.
import { SUPABASE_URL, sbHeaders, envError } from "./_lib.js";

const CLE = process.env.ROBOT_WHATSAPP_CLE;

export default async (req, res) => {
  const err = envError();
  if (err) { res.status(500).json({ ok: false, error: err }); return; }
  const cle = (req.query && req.query.cle) || "";
  if (!CLE || cle !== CLE) { res.status(401).json({ ok: false, error: "non autorisé" }); return; }
  const client = (req.query.client || "").trim();
  if (!client) { res.status(400).json({ ok: false, error: "param client requis" }); return; }

  const r = await fetch(`${SUPABASE_URL}/rest/v1/wifi_payment_requests?client_nom=eq.${encodeURIComponent(client)}&status=eq.pending`, {
    method: "PATCH", headers: sbHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({ status: "accepted" }),
  });
  const data = await r.json().catch(() => "?");
  res.status(200).json({ ok: r.ok, status: r.status, resolues: data });
};
