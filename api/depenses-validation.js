// api/depenses-validation.js
// Validation des dépenses par WhatsApp (via le robot).
//
//   GET  ?cle=SECRET
//        -> { ok, adminTel, events:[{table,id,code,message}] }  (dépenses en
//           attente, pas encore notifiées à l'admin principal)
//   POST ?cle=SECRET { action:"marquer", ids:[{table,id}] }
//        -> marque alertee_validation = true
//   POST ?cle=SECRET { action:"decider", code, decision:"valider|rejeter",
//                      motif?, admin_tel }
//        -> approuve / rejette la dépense ; renvoie la confirmation à l'admin
//           et la notification destinée à l'initiateur de la dépense.
//
// Seul l'ADMINISTRATEUR PRINCIPAL (is_principal) peut décider. Le rejet exige
// un motif. L'initiateur (technicien / personne) est prévenu via son numéro
// enregistré dans sa fiche utilisateur.

import { SUPABASE_URL, sbHeaders, envError } from "./_lib.js";

const CLE_ROBOT = process.env.ROBOT_WHATSAPP_CLE;
const CLE_CRON = process.env.RELANCE_CRON_SECRET;

// Description des 3 types de dépense (table + champs).
const TYPES = {
  wifi_fuel_expenses: { label: "Carburant", select: "id,montant,technicien_nom,technicien_id,client_nom,approval_status,alertee_validation", persNom: "technicien_nom", persId: "technicien_id", noteField: "client_nom", notePrefix: "Client" },
  wifi_perdiem:       { label: "Perdiem",   select: "id,montant,personne_nom,personne_id,note,approval_status,alertee_validation", persNom: "personne_nom", persId: "personne_id", noteField: "note", notePrefix: "Note" },
  wifi_other_expenses:{ label: "Autre dépense", select: "id,montant,description,approval_status,alertee_validation", persNom: null, persId: null, noteField: "description", notePrefix: "Détail" },
};

function normalizePhone(raw) {
  let d = (raw || "").replace(/[^\d]/g, "");
  if (!d) return "";
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 8) return "228" + d;
  return d;
}
function fmtMontant(n) {
  const v = Number(n);
  if (!isFinite(v)) return String(n ?? "");
  return v.toLocaleString("fr-FR").replace(/ /g, " ");
}
function codeDe(id) { return String(id).replace(/-/g, "").slice(0, 6).toUpperCase(); }

async function lire(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: sbHeaders() });
  if (!r.ok) throw new Error(`lecture ${path} — ${r.status} ${await r.text().catch(() => "")}`);
  return (await r.json().catch(() => [])) || [];
}

// L'admin principal (is_principal) ; renvoie {nom, tel} ou null.
async function adminPrincipal() {
  const arr = await lire("wifi_users?select=nom,telephone,is_principal,role&role=eq.admin&is_principal=is.true");
  const u = arr[0];
  if (!u) return null;
  return { nom: u.nom || "Admin", tel: normalizePhone(u.telephone) };
}

function messageAdmin(typeConf, row) {
  const code = codeDe(row.id);
  const qui = typeConf.persNom ? (row[typeConf.persNom] || "?") : "—";
  const note = typeConf.noteField ? (row[typeConf.noteField] || "") : "";
  const lignes = [
    `💸 *Dépense à valider — #${code}*`,
    `Type : ${typeConf.label} · *${fmtMontant(row.montant)} F*`,
  ];
  if (typeConf.persNom) lignes.push(`Par : ${qui}`);
  if (note) lignes.push(`${typeConf.notePrefix} : ${note}`);
  lignes.push("");
  lignes.push(`✅ Pour VALIDER, réponds : *VALIDER ${code}*`);
  lignes.push(`❌ Pour REJETER, réponds : *REJETER ${code} motif*`);
  return lignes.join("\n");
}

export default async (req, res) => {
  const err = envError();
  if (err) { res.status(500).json({ ok: false, error: err }); return; }
  const cle = (req.query && req.query.cle) || "";
  if (!((CLE_ROBOT && cle === CLE_ROBOT) || (CLE_CRON && cle === CLE_CRON))) {
    res.status(401).json({ ok: false, error: "Non autorisé." }); return;
  }

  try {
    // ---------- POST ----------
    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }
      const action = body && body.action;

      // Marquer des dépenses comme "déjà notifiées à l'admin".
      if (action === "marquer") {
        const ids = (body && Array.isArray(body.ids)) ? body.ids : [];
        const parTable = {};
        for (const m of ids) {
          if (!m || !TYPES[m.table] || m.id == null) continue;
          (parTable[m.table] = parTable[m.table] || []).push(m.id);
        }
        let total = 0;
        for (const [table, list] of Object.entries(parTable)) {
          const liste = list.map((x) => encodeURIComponent(x)).join(",");
          const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=in.(${liste})`, {
            method: "PATCH", headers: sbHeaders({ Prefer: "return=minimal" }),
            body: JSON.stringify({ alertee_validation: true }),
          });
          if (r.ok) total += list.length;
        }
        res.status(200).json({ ok: true, marques: total });
        return;
      }

      // Décider (valider / rejeter) une dépense.
      if (action === "decider") {
        const admin = await adminPrincipal();
        const adminTel = normalizePhone(body && body.admin_tel);
        if (!admin || !admin.tel || admin.tel !== adminTel) {
          res.status(403).json({ ok: false, error: "non_principal" }); return;
        }
        const code = String((body && body.code) || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
        const decision = (body && body.decision) === "rejeter" ? "rejeter" : "valider";
        const motif = String((body && body.motif) || "").trim();
        if (decision === "rejeter" && !motif) { res.status(400).json({ ok: false, error: "motif_requis" }); return; }
        if (!code) { res.status(400).json({ ok: false, error: "code_requis" }); return; }

        // Retrouve la dépense EN ATTENTE dont l'id commence par ce code.
        let trouve = null;
        for (const [table, conf] of Object.entries(TYPES)) {
          const rows = await lire(`${table}?select=${conf.select}&approval_status=eq.pending`);
          const row = rows.find((x) => codeDe(x.id) === code);
          if (row) { trouve = { table, conf, row }; break; }
        }
        if (!trouve) { res.status(404).json({ ok: false, error: "introuvable" }); return; }

        const { table, conf, row } = trouve;
        const nouveau = decision === "valider" ? "approved" : "rejected";
        const patch = {
          approval_status: nouveau,
          decided_by: admin.nom,
          decided_at: new Date().toISOString(),
          rejet_motif: decision === "rejeter" ? motif : null,
        };
        const up = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(row.id)}`, {
          method: "PATCH", headers: sbHeaders({ Prefer: "return=minimal" }), body: JSON.stringify(patch),
        });
        if (!up.ok) { res.status(500).json({ ok: false, error: `maj ${up.status}` }); return; }

        // Journal d'activité.
        await fetch(`${SUPABASE_URL}/rest/v1/wifi_activity_log`, {
          method: "POST", headers: sbHeaders({ Prefer: "return=minimal" }),
          body: JSON.stringify({
            actor_nom: admin.nom, actor_role: "admin",
            action: decision === "valider" ? "approve_expense_whatsapp" : "reject_expense_whatsapp",
            details: `${conf.label} ${fmtMontant(row.montant)} F ${decision === "valider" ? "validée" : "rejetée"} par WhatsApp${decision === "rejeter" ? " — motif : " + motif : ""}`,
          }),
        }).catch(() => {});

        // Notification à l'initiateur (si on a son numéro).
        let initiator = null;
        if (conf.persId && row[conf.persId]) {
          const us = await lire(`wifi_users?select=nom,telephone&id=eq.${encodeURIComponent(row[conf.persId])}`);
          const tel = us[0] ? normalizePhone(us[0].telephone) : "";
          if (tel) {
            const msg = decision === "valider"
              ? `✅ *APESPOT* — Votre dépense de ${fmtMontant(row.montant)} F (${conf.label}) a été *validée*. Merci.`
              : `❌ *APESPOT* — Votre dépense de ${fmtMontant(row.montant)} F (${conf.label}) a été *rejetée*.\nMotif : ${motif}`;
            initiator = { telephone: tel, message: msg };
          }
        }

        const qui = conf.persNom ? (row[conf.persNom] || "?") : "";
        const adminConfirm = decision === "valider"
          ? `✅ Dépense #${code} (${conf.label} ${fmtMontant(row.montant)} F${qui ? " · " + qui : ""}) *validée*.` + (initiator ? ` ${qui} a été notifié.` : "")
          : `❌ Dépense #${code} (${conf.label} ${fmtMontant(row.montant)} F${qui ? " · " + qui : ""}) *rejetée* (motif : ${motif}).` + (initiator ? ` ${qui} a été notifié.` : "");

        res.status(200).json({ ok: true, adminConfirm, initiator });
        return;
      }

      res.status(400).json({ ok: false, error: "action inconnue" });
      return;
    }

    // ---------- GET : dépenses en attente à notifier à l'admin ----------
    const admin = await adminPrincipal();
    const events = [];
    for (const [table, conf] of Object.entries(TYPES)) {
      const rows = await lire(`${table}?select=${conf.select}&approval_status=eq.pending&alertee_validation=is.false&order=created_at.asc`);
      for (const row of rows) {
        events.push({ table, id: row.id, code: codeDe(row.id), message: messageAdmin(conf, row) });
      }
    }
    res.status(200).json({ ok: true, adminTel: admin ? admin.tel : "", events });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
};
