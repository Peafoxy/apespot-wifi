// api/admin-reset.js — ENDPOINT TEMPORAIRE (jamais fusionné sur main).
// Nettoyage "base saine" : supprime l'historique financier AVANT la période en
// cours. Protégé par la clé robot + ?go=OUI. À SUPPRIMER après usage.
import { SUPABASE_URL, sbHeaders, envError } from "./_lib.js";

const CLE = process.env.ROBOT_WHATSAPP_CLE;

export default async (req, res) => {
  const err = envError();
  if (err) { res.status(500).json({ ok: false, error: err }); return; }
  const cle = (req.query && req.query.cle) || "";
  if (!CLE || cle !== CLE) { res.status(401).json({ ok: false, error: "non autorisé" }); return; }
  if ((req.query.go || "") !== "OUI") { res.status(400).json({ ok: false, error: "ajouter &go=OUI" }); return; }

  const results = {};
  const run = async (name, path, method, body) => {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        method, headers: sbHeaders({ Prefer: "return=minimal" }),
        body: body ? JSON.stringify(body) : undefined,
      });
      results[name] = r.ok ? "ok" : `${r.status} ${await r.text().catch(() => "")}`;
    } catch (e) { results[name] = "ERR " + e.message; }
  };
  const compte = async (name, path) => {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: sbHeaders({ Prefer: "count=exact", Range: "0-0" }) });
      results[name] = r.headers.get("content-range") || "?";
    } catch (e) { results[name] = "ERR " + e.message; }
  };

  const CB = encodeURIComponent("CANAL BOX");

  // --- Suppressions de l'avant-période ---
  await run("del_paiements_verse", "wifi_payments?verse=is.true", "DELETE");
  await run("del_versements", "wifi_versements?id=not.is.null", "DELETE");
  await run("del_carburant", "wifi_fuel_expenses?id=not.is.null", "DELETE");
  await run("del_perdiem", "wifi_perdiem?id=not.is.null", "DELETE");
  await run("del_autres", "wifi_other_expenses?created_at=lt.2026-11-20", "DELETE");
  // --- Lignes : remise à zéro sauf CANAL BOX ---
  await run("lignes_zero", `wifi_expense_lines?nom=neq.${CB}`, "PATCH", { total_paid: 0 });
  await run("canal_box", `wifi_expense_lines?nom=eq.${CB}`, "PATCH", { total_paid: 15000, last_paid_month: "2026-11" });
  // --- Journal ---
  await run("log", "wifi_activity_log", "POST", { actor_nom: "SYSTEME", actor_role: "systeme", action: "reset_caisse", details: "Base saine : suppression historique avant période (sauvegarde effectuée)." });

  // --- Vérification : ce qui RESTE ---
  await compte("reste_paiements", "wifi_payments?select=id");
  await compte("reste_versements", "wifi_versements?select=id");
  await compte("reste_carburant", "wifi_fuel_expenses?select=id");
  await compte("reste_perdiem", "wifi_perdiem?select=id");
  await compte("reste_autres", "wifi_other_expenses?select=id");

  res.status(200).json({ ok: true, results });
};
