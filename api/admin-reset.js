// api/admin-reset.js — ENDPOINT TEMPORAIRE (jamais fusionné sur main).
// Correction base saine : efface la date de paiement des lignes autres que
// CANAL BOX (leur montant avait été remis à 0 mais la date restait, ce qui
// faisait recompter leur montant dans la "période"). À SUPPRIMER après usage.
import { SUPABASE_URL, sbHeaders, envError } from "./_lib.js";

const CLE = process.env.ROBOT_WHATSAPP_CLE;

export default async (req, res) => {
  const err = envError();
  if (err) { res.status(500).json({ ok: false, error: err }); return; }
  const cle = (req.query && req.query.cle) || "";
  if (!CLE || cle !== CLE) { res.status(401).json({ ok: false, error: "non autorisé" }); return; }
  if ((req.query.go || "") !== "OUI") { res.status(400).json({ ok: false, error: "ajouter &go=OUI" }); return; }

  const results = {};
  const CB = encodeURIComponent("CANAL BOX");

  // Lignes ≠ CANAL BOX : total payé = 0 ET date de paiement effacée (sinon la
  // période recompte leur montant mensuel).
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/wifi_expense_lines?nom=neq.${CB}`, {
      method: "PATCH", headers: sbHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify({ total_paid: 0, paid_action_at: null }),
    });
    results.lignes_autres = r.ok ? "ok" : `${r.status} ${await r.text().catch(() => "")}`;
  } catch (e) { results.lignes_autres = "ERR " + e.message; }

  // Vérification : état final des lignes.
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/wifi_expense_lines?select=nom,montant,total_paid,paid_action_at&order=nom`, { headers: sbHeaders() });
    results.lignes = await r.json().catch(() => "?");
  } catch (e) { results.lignes = "ERR " + e.message; }

  res.status(200).json({ ok: true, results });
};
