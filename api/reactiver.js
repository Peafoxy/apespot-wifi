// api/reactiver.js
// Réactivation d'un client pilotée par WhatsApp (via le robot). Un administrateur
// envoie « REACTIVER <nom ou code> <montant> » au robot, confirme par OUI, et le
// robot appelle ce point serveur qui :
//   - retrouve le client,
//   - prolonge l'abonnement d'1 mois (même règle que l'app),
//   - enregistre le paiement dans la caisse (montant, mode),
//   - trace l'action dans le journal d'activité,
//   - renvoie le message de réactivation à envoyer au client.
//
//   GET  ?cle=SECRET&q=<nom|code>&admin_tel=<num> -> { ok, matches:[...] }
//   POST ?cle=SECRET { id, montant, mode?, admin_tel } -> { ok, client, clientMessage }
//
// Sécurité : l'appelant doit fournir le numéro d'un ADMINISTRATEUR enregistré
// (admin_tel) ; sinon l'opération est refusée. Lomé = UTC+0.

import { SUPABASE_URL, sbHeaders, envError } from "./_lib.js";

const CLE_ROBOT = process.env.ROBOT_WHATSAPP_CLE;
const CLE_CRON = process.env.RELANCE_CRON_SECRET;

function pad(n) { return String(n).padStart(2, "0"); }
function todayStrUTC() {
  const t = new Date();
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
function fmtDateFr(dateExp) {
  if (!dateExp) return "—";
  const d = new Date(dateExp + "T00:00:00Z");
  if (isNaN(d.getTime())) return dateExp;
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}
function greeting() {
  const h = new Date().getUTCHours();
  return (h >= 18 || h < 5) ? "Bonsoir" : "Bonjour";
}
function normalizePhone(raw) {
  let d = (raw || "").replace(/[^\d]/g, "");
  if (!d) return "";
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 8) return "228" + d;
  return d;
}
function estExpire(dateExp, today) {
  if (!dateExp) return true;
  return dateExp < today; // chaîne AAAA-MM-JJ comparable
}
function addOneMonthClamped(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = d.getUTCDate();
  const totalMonths = d.getUTCFullYear() * 12 + d.getUTCMonth() + 1;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = totalMonths % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const newDay = Math.min(day, lastDay);
  const nd = new Date(Date.UTC(targetYear, targetMonth, newDay));
  return `${nd.getUTCFullYear()}-${pad(nd.getUTCMonth() + 1)}-${pad(nd.getUTCDate())}`;
}
// Même règle que computeRenewedExpiration de l'app : si l'abonnement court encore,
// on prolonge à partir de l'échéance ; s'il est expiré, à partir d'aujourd'hui.
function nouvelleEcheance(currentDateExp, today) {
  if (!currentDateExp) return addOneMonthClamped(today);
  const base = estExpire(currentDateExp, today) ? today : currentDateExp;
  return addOneMonthClamped(base);
}

// ---- Garde-fou anti double-réabonnement (mêmes seuils que l'app) ----
const RENEW_COOLDOWN_MS = 60 * 60 * 1000;        // 1h : blocage ferme (sauf admin principal)
const RENEW_GUARD_MS = 24 * 60 * 60 * 1000;      // 1h-24h : avertissement + confirmation OUI
function fmtDateHeureFr(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)} à ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
// Calcule l'état du garde-fou pour un client qui vient (ou non) d'être réabonné.
// isPrincipal : l'admin principal n'est jamais bloqué (comme sur l'app).
function calcGarde(renewedAt, renewedBy, isPrincipal) {
  if (!renewedAt) return { bloque: false, avertir: false };
  const elapsed = Date.now() - new Date(renewedAt).getTime();
  if (isNaN(elapsed)) return { bloque: false, avertir: false };
  if (!isPrincipal && elapsed < RENEW_COOLDOWN_MS) {
    const minutesLeft = Math.max(1, Math.ceil((RENEW_COOLDOWN_MS - elapsed) / 60000));
    return { bloque: true, avertir: false, minutesLeft };
  }
  if (elapsed < RENEW_GUARD_MS) {
    return { bloque: false, avertir: true, qui: renewedBy || "", quandFr: fmtDateHeureFr(renewedAt) };
  }
  return { bloque: false, avertir: false };
}

// Message diffusé aux AUTRES administrateurs après un réabonnement.
// Ex. : « ✅ANGEL a réactivé FATI. Valide jusqu'au 22/12/2026. Paiement de 10 300 F (Mix by Yas) enregistré dans la caisse. »
function messageEquipe(adminNom, clientNom, newExpFr, montant, mode) {
  const m = (Number(montant) || 0).toLocaleString("fr-FR");
  return `✅${adminNom} a réactivé ${clientNom}. Valide jusqu'au ${newExpFr}. Paiement de ${m} F (${mode}) enregistré dans la caisse.`;
}

async function lire(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: sbHeaders() });
  if (!r.ok) throw new Error(`lecture ${path} — ${r.status} ${await r.text().catch(() => "")}`);
  return (await r.json().catch(() => [])) || [];
}

// Retrouve l'administrateur correspondant à admin_tel (ou null).
async function trouverAdmin(adminTel) {
  const num = normalizePhone(adminTel);
  if (!num) return null;
  const admins = await lire("wifi_users?select=nom,telephone,is_principal&role=eq.admin");
  return admins.find((u) => normalizePhone(u.telephone) === num) || null;
}
// Vrai si admin_tel correspond à un administrateur enregistré.
async function estAdmin(adminTel) {
  return !!(await trouverAdmin(adminTel));
}
// Numéros (normalisés) de tous les admins SAUF l'auteur, pour la diffusion d'équipe.
async function autresAdminsTel(auteurTel) {
  const auteur = normalizePhone(auteurTel);
  const admins = await lire("wifi_users?select=nom,telephone&role=eq.admin");
  const vus = new Set();
  const out = [];
  for (const u of admins) {
    const tel = normalizePhone(u.telephone);
    if (!tel || tel === auteur || vus.has(tel)) continue;
    vus.add(tel);
    out.push({ nom: u.nom || "", telephone: tel });
  }
  return out;
}

function messageClient(c, newExp) {
  const dateFr = fmtDateFr(newExp);
  const codeLine = c.access_code ? `TON CODE : ${c.access_code}` : "(demande ton code à APESPOT WI-FI)";
  return [
    `${greeting()} ${c.nom}`,
    ``,
    `Votre abonnement WiFi APESPOT a été *réactivé* ✅`,
    `Il est valable jusqu'au *${dateFr}*.`,
    ``,
    `Merci de votre confiance !`,
    ``,
    `Accède à ton espace :`,
    `https://apespot-wifi.vercel.app`,
    ``,
    codeLine,
  ].join("\n");
}

function fmtFCFAForPdf(n) {
  return (Number(n) || 0).toLocaleString("fr-FR").replace(/ /g, " ") + " F";
}

// Reçu de paiement en PDF (même présentation que l'app), renvoyé en base64.
// Généré côté serveur avec jsPDF. En cas d'échec (environnement), on renvoie
// null : la réactivation réussit quand même, juste sans reçu joint.
async function genererRecuBase64(payment) {
  try {
    const _mod = await import("jspdf");
    const jsPDF = _mod.jsPDF || (_mod.default && _mod.default.jsPDF) || _mod.default;
    const doc = new jsPDF({ unit: "mm", format: "a5" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const marginX = 15;
    const tableWidth = pageWidth - marginX * 2;

    doc.setTextColor(20, 30, 42);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("APESPOT WI-FI", pageWidth / 2, 18, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(110, 120, 130);
    doc.text("Reçu de paiement", pageWidth / 2, 25, { align: "center" });
    doc.setDrawColor(62, 216, 195);
    doc.setLineWidth(0.8);
    doc.line(pageWidth / 2 - 16, 29, pageWidth / 2 + 16, 29);

    const rows = [
      ["Client", payment.clientNom || "—"],
      ["Montant", fmtFCFAForPdf(payment.montant)],
      ["Mode de paiement", payment.mode || "—"],
      ["Date", fmtDateFr(payment.date)],
    ];
    if (payment.newExpiration) rows.push(["Abonnement valable jusqu'au", fmtDateFr(payment.newExpiration)]);
    if (payment.note) {
      // Reçu CLIENT : on retire le « par <nom> » (info interne de traçabilité).
      // Ex. « Réactivation via WhatsApp par TIMO » -> « Réactivation via WhatsApp ».
      const refPublique = String(payment.note).replace(/\s+par\s+.+$/i, "").trim();
      if (refPublique) rows.push(["Référence", refPublique]);
    }
    rows.push(["N° de reçu", payment.id ? String(payment.id).slice(0, 8).toUpperCase() : "—"]);

    const rowH = 11;
    const colLabelW = tableWidth * 0.46;
    const y = 42;
    doc.setDrawColor(210, 216, 224);
    doc.setLineWidth(0.25);
    rows.forEach((row, i) => {
      const rowY = y + i * rowH;
      if (i % 2 === 0) { doc.setFillColor(244, 247, 250); doc.rect(marginX, rowY, tableWidth, rowH, "F"); }
      doc.line(marginX, rowY, marginX + tableWidth, rowY);
      doc.line(marginX + colLabelW, rowY, marginX + colLabelW, rowY + rowH);
      doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(40, 48, 58);
      doc.text(row[0], marginX + 4, rowY + rowH / 2 + 1.3, { maxWidth: colLabelW - 6 });
      doc.setFont("helvetica", "normal"); doc.setTextColor(20, 20, 20);
      doc.text(String(row[1]), marginX + colLabelW + 4, rowY + rowH / 2 + 1.3, { maxWidth: tableWidth - colLabelW - 8 });
    });
    const tableBottom = y + rows.length * rowH;
    doc.line(marginX, tableBottom, marginX + tableWidth, tableBottom);
    doc.rect(marginX, y, tableWidth, rows.length * rowH);
    doc.setFontSize(8.5); doc.setTextColor(140, 148, 158); doc.setFont("helvetica", "italic");
    doc.text("Merci de votre confiance — APESPOT WI-FI", pageWidth / 2, tableBottom + 12, { align: "center" });

    const ab = doc.output("arraybuffer");
    return Buffer.from(ab).toString("base64");
  } catch (e) {
    return null;
  }
}

export default async (req, res) => {
  const err = envError();
  if (err) { res.status(500).json({ ok: false, error: err }); return; }

  const cle = (req.query && req.query.cle) || "";
  const autorise = (CLE_ROBOT && cle === CLE_ROBOT) || (CLE_CRON && cle === CLE_CRON);
  if (!autorise) { res.status(401).json({ ok: false, error: "Non autorisé." }); return; }

  const today = todayStrUTC();

  try {
    // ---------- POST : réactivation effective ----------
    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }
      const id = body && body.id;
      const montant = Number(body && body.montant);
      const mode = (body && body.mode) ? String(body.mode) : "Mix by Yas";
      const adminTel = body && body.admin_tel;
      const force = body && (body.force === true || body.force === "true" || body.force === 1);

      const admin = await trouverAdmin(adminTel);
      if (!admin) { res.status(403).json({ ok: false, error: "non_admin" }); return; }
      if (!id) { res.status(400).json({ ok: false, error: "id manquant" }); return; }
      if (!montant || montant <= 0) { res.status(400).json({ ok: false, error: "montant invalide" }); return; }

      const clients = await lire(`wifi_clients?id=eq.${encodeURIComponent(id)}&select=id,nom,telephone,date_exp,access_code,renewed_at,renewed_by`);
      const c = clients[0];
      if (!c) { res.status(404).json({ ok: false, error: "client introuvable" }); return; }

      // Garde-fou anti double-réabonnement.
      const garde = calcGarde(c.renewed_at, c.renewed_by, !!admin.is_principal);
      if (garde.bloque) {
        res.status(409).json({ ok: false, error: "bloque_1h", minutesLeft: garde.minutesLeft, client: { nom: c.nom } });
        return;
      }
      if (garde.avertir && !force) {
        res.status(409).json({ ok: false, error: "confirmation_requise", qui: garde.qui, quandFr: garde.quandFr, client: { nom: c.nom } });
        return;
      }

      const newExp = nouvelleEcheance(c.date_exp, today);

      // 1) Enregistre le paiement (compte dans la caisse ; verse=false par défaut).
      //    equipe_alertee=true : le robot diffuse le message à l'équipe tout de
      //    suite (recipients ci-dessous), donc alertes-equipe.js ne le reprend pas.
      const adminNum = normalizePhone(adminTel);
      const adminNom = admin.nom || "Admin (WhatsApp)";
      const noteReact = `Réactivation via WhatsApp par ${adminNom}`;
      const payRes = await fetch(`${SUPABASE_URL}/rest/v1/wifi_payments`, {
        method: "POST",
        headers: sbHeaders({ Prefer: "return=representation" }),
        body: JSON.stringify({
          client_nom: c.nom,
          montant,
          mode,
          date: today,
          new_expiration: newExp,
          note: noteReact,
          encaisse_par: adminNom,
          equipe_alertee: true,
        }),
      });
      if (!payRes.ok) { res.status(500).json({ ok: false, error: `paiement ${payRes.status} ${await payRes.text().catch(() => "")}` }); return; }
      const payArr = await payRes.json().catch(() => []);
      const paiementId = (Array.isArray(payArr) && payArr[0] && payArr[0].id) ? payArr[0].id : null;

      // 2) Prolonge l'abonnement du client.
      const cliRes = await fetch(`${SUPABASE_URL}/rest/v1/wifi_clients?id=eq.${encodeURIComponent(c.id)}`, {
        method: "PATCH",
        headers: sbHeaders({ Prefer: "return=minimal" }),
        body: JSON.stringify({
          date_exp: newExp,
          previous_date_exp: c.date_exp || null,
          renewed_at: new Date().toISOString(),
          renewed_by: adminNom,
        }),
      });
      if (!cliRes.ok) { res.status(500).json({ ok: false, error: `maj client ${cliRes.status} ${await cliRes.text().catch(() => "")}` }); return; }

      // 2bis) Résout toute demande de paiement EN ATTENTE de ce client : le
      // réabonnement WhatsApp fait office de validation, pour ne pas laisser une
      // demande orpheline « à valider » sur le site.
      await fetch(`${SUPABASE_URL}/rest/v1/wifi_payment_requests?client_nom=eq.${encodeURIComponent(c.nom)}&status=eq.pending`, {
        method: "PATCH",
        headers: sbHeaders({ Prefer: "return=minimal" }),
        body: JSON.stringify({ status: "accepted" }),
      }).catch(() => {});

      // 3) Trace dans le journal d'activité.
      await fetch(`${SUPABASE_URL}/rest/v1/wifi_activity_log`, {
        method: "POST",
        headers: sbHeaders({ Prefer: "return=minimal" }),
        body: JSON.stringify({
          actor_nom: adminNom,
          actor_role: "admin",
          action: "reactivate_whatsapp",
          details: `Réactivation WhatsApp de "${c.nom}" · ${montant} F (${mode}) · abonnement jusqu'au ${fmtDateFr(newExp)}`,
        }),
      }).catch(() => {});

      // 4) Reçu PDF à joindre au message WhatsApp du client.
      const recuBase64 = await genererRecuBase64({
        clientNom: c.nom,
        montant,
        mode,
        date: today,
        newExpiration: newExp,
        note: noteReact,
        id: paiementId,
      });
      const recuNom = `Recu-${(c.nom || "client").replace(/[\\/:*?"<>|]+/g, " ").trim().replace(/\s+/g, "-")}-${today}.pdf`;

      // 5) Diffusion immédiate à TOUS les autres admins (sauf l'auteur).
      const destinataires = await autresAdminsTel(adminTel).catch(() => []);
      const broadcast = {
        message: messageEquipe(adminNom, c.nom, fmtDateFr(newExp), montant, mode),
        destinataires, // [{ nom, telephone }]
      };

      res.status(200).json({
        ok: true,
        client: {
          nom: c.nom,
          telephone: normalizePhone(c.telephone),
          newExpiration: newExp,
          newExpirationFr: fmtDateFr(newExp),
        },
        clientMessage: messageClient(c, newExp),
        mode,
        recuPdf: recuBase64,     // base64 (sans préfixe), ou null si non généré
        recuNom,
        broadcast,               // message + destinataires (autres admins) à diffuser
      });
      return;
    }

    // ---------- GET : recherche du client ----------
    const q = ((req.query && req.query.q) || "").trim();
    const adminTel = (req.query && req.query.admin_tel) || "";
    const adminGet = await trouverAdmin(adminTel);
    if (!adminGet) { res.status(403).json({ ok: false, error: "non_admin" }); return; }
    if (!q) { res.status(400).json({ ok: false, error: "recherche vide" }); return; }

    // Recherche par code exact OU par nom (contient). Deux requêtes fusionnées
    // pour éviter les soucis d'échappement du filtre or() de PostgREST.
    const select = "select=id,nom,telephone,date_exp,access_code,renewed_at,renewed_by";
    const [parCode, parNom] = await Promise.all([
      lire(`wifi_clients?access_code=eq.${encodeURIComponent(q.toUpperCase())}&${select}`),
      lire(`wifi_clients?nom=ilike.*${encodeURIComponent(q)}*&${select}`),
    ]);
    const vus = new Set();
    const matches = [];
    for (const c of [...parCode, ...parNom]) {
      if (vus.has(c.id)) continue;
      vus.add(c.id);
      matches.push({
        id: c.id,
        nom: c.nom,
        accessCode: c.access_code || "",
        dateExp: c.date_exp || null,
        dateExpFr: fmtDateFr(c.date_exp),
        newExpiration: nouvelleEcheance(c.date_exp, today),
        newExpirationFr: fmtDateFr(nouvelleEcheance(c.date_exp, today)),
        aNumero: !!normalizePhone(c.telephone),
        // Garde-fou : indique au robot si ce client vient d'être réabonné.
        garde: calcGarde(c.renewed_at, c.renewed_by, !!adminGet.is_principal),
      });
    }
    res.status(200).json({ ok: true, total: matches.length, matches });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
};
