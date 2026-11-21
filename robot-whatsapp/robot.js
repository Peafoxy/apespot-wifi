// robot.js — Robot WhatsApp APESPOT
// ------------------------------------------------------------------
// Envoie automatiquement les rappels d'abonnement aux clients, chaque jour à
// l'heure configurée. Conçu pour tourner sur un ordinateur Windows toujours
// allumé. Il ne contient AUCUNE clé de base de données : il demande la liste
// des clients à notifier au serveur APESPOT (déjà écrite), les envoie sur
// WhatsApp, puis dit au serveur quels clients ont été relancés.
//
// Lancer :   npm start              (fonctionnement normal)
//            npm run test-envoi     (envoie tout de suite, pour tester)
// ------------------------------------------------------------------

require("dotenv").config();
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const cron = require("node-cron");

const APP_URL = (process.env.APP_URL || "https://apespot-wifi.vercel.app").replace(/\/+$/, "");
const CLE = process.env.CLE || "";
// Heures de vérification des rappels (plusieurs par jour pour rattraper un
// éventuel incident : si 8h est raté, 10h ou 14h rattrape — un client déjà
// relancé dans la journée n'est jamais renotifié).
const HEURES = (() => {
  const raw = process.env.HEURES_ENVOI || process.env.HEURE_ENVOI || "8,10,14";
  const set = new Set();
  String(raw).split(/[,;\s]+/).forEach((x) => {
    const h = parseInt(x.trim(), 10);
    if (Number.isInteger(h) && h >= 0 && h <= 23) set.add(h);
  });
  if (set.size === 0) set.add(8);
  return [...set].sort((a, b) => a - b);
})();

// Délai aléatoire entre deux envois (en millisecondes) : imite un envoi humain
// et évite de ressembler à un robot qui tire en rafale.
const DELAI_MIN = 8000;   // 8 secondes
const DELAI_MAX = 22000;  // 22 secondes
const MAX_PAR_RUN = 40;   // sécurité : jamais plus de 40 messages par passage

// Alertes à l'équipe (paiement / ticket / réclamation) : fréquence de contrôle.
const ALERTE_INTERVALLE_MIN = Math.max(1, parseInt(process.env.ALERTE_INTERVALLE_MIN || "3", 10) || 3);

function log(...a) { console.log(new Date().toLocaleString("fr-FR"), "-", ...a); }
function dodo(ms) { return new Promise((r) => setTimeout(r, ms)); }
function alea(a, b) { return Math.floor(a + Math.random() * (b - a)); }

if (!CLE) {
  log("ERREUR : la clé CLE n'est pas renseignée dans le fichier .env — arrêt.");
  process.exit(1);
}

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: "./session" }),
  puppeteer: { args: ["--no-sandbox", "--disable-setuid-sandbox"] },
});

client.on("qr", (qr) => {
  console.log("\n>>> Scanne ce QR code avec le WhatsApp du téléphone APESPOT :");
  console.log("    WhatsApp  >  Appareils connectés  >  Lier un appareil\n");
  qrcode.generate(qr, { small: true });
});

client.on("authenticated", () => log("WhatsApp authentifié ✓"));
client.on("auth_failure", (m) => log("Échec d'authentification :", m));

client.on("ready", () => {
  log("Robot connecté et prêt ✓");
  log(`Rappels clients : à ${HEURES.map((h) => h + "h").join(", ")} (heure de Lomé). Un client déjà relancé n'est pas renotifié.`);
  log(`Alertes équipe : vérifiées toutes les ${ALERTE_INTERVALLE_MIN} min.`);
  // 1) Rappels d'abonnement aux clients, à plusieurs heures (rattrapage si incident).
  HEURES.forEach((h) => {
    cron.schedule(`0 ${h} * * *`, () => {
      envoyerRappels().catch((e) => log("Erreur pendant l'envoi :", e.message));
    });
  });
  // 2) Alertes à l'équipe (paiement / ticket / réclamation), régulièrement.
  cron.schedule(`*/${ALERTE_INTERVALLE_MIN} * * * *`, () => {
    envoyerAlertesEquipe().catch((e) => log("Erreur alertes équipe :", e.message));
  });
  // 3) Dépenses à faire valider par l'admin principal, régulièrement.
  cron.schedule(`*/${ALERTE_INTERVALLE_MIN} * * * *`, () => {
    envoyerValidations().catch((e) => log("Erreur validations :", e.message));
  });
  // Option de test : « npm run test-envoi » lance tout de suite.
  if (process.argv.includes("--maintenant")) {
    log("Option --maintenant : envoi immédiat (test).");
    envoyerRappels().catch((e) => log("Erreur pendant l'envoi :", e.message));
    envoyerAlertesEquipe().catch((e) => log("Erreur alertes équipe :", e.message));
    envoyerValidations().catch((e) => log("Erreur validations :", e.message));
  }
});

client.on("disconnected", (raison) => {
  log("Déconnecté de WhatsApp :", raison, "— tentative de reconnexion…");
  client.initialize().catch(() => {});
});

// ---------------------------------------------------------------------------
// Commande WhatsApp : « REACTIVER <nom ou code> <montant> » puis « OUI ».
// Seuls les administrateurs enregistrés (numéro sur leur fiche) sont obéis ;
// pour tout autre message, le robot NE répond PAS (les clients écrivent aussi
// sur ce numéro — on ne doit pas interférer avec le support humain).
// ---------------------------------------------------------------------------
const PENDING_TTL_MS = 10 * 60 * 1000; // une confirmation OUI vaut 10 min
const pendings = new Map();            // numéro admin -> { id, nom, montant, newExpirationFr, expire }

async function appelReactiverGET(q, adminTel) {
  const url = `${APP_URL}/api/reactiver?cle=${encodeURIComponent(CLE)}&q=${encodeURIComponent(q)}&admin_tel=${encodeURIComponent(adminTel)}`;
  const res = await fetch(url);
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
async function appelReactiverPOST(id, montant, mode, adminTel) {
  const corps = { id, montant, admin_tel: adminTel };
  if (mode) corps.mode = mode; // sinon le serveur met « Mix by Yas » par défaut
  const res = await fetch(`${APP_URL}/api/reactiver?cle=${encodeURIComponent(CLE)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corps),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

client.on("message", async (msg) => {
  try {
    if (msg.fromMe) return;
    if (!msg.from || !msg.from.endsWith("@c.us")) return; // ignore groupes / statuts
    const adminTel = msg.from.replace("@c.us", "");       // numéro de l'expéditeur
    const texte = (msg.body || "").trim();
    const haut = texte.toUpperCase();

    // 1) Commande de réactivation.
    if (haut.startsWith("REACTIVER") || haut.startsWith("RÉACTIVER")) {
      const reste = texte.replace(/^r[ée]activer/i, "").trim();
      const tokens = reste.split(/\s+/).filter(Boolean);
      // Le montant est le 1er token purement numérique : avant = client, après = mode (optionnel).
      const idxMontant = tokens.findIndex((t) => /^\d+$/.test(t.replace(/[.\s]/g, "")));
      const montant = idxMontant >= 0 ? parseInt(tokens[idxMontant].replace(/[.\s]/g, ""), 10) : NaN;
      const q = (idxMontant >= 0 ? tokens.slice(0, idxMontant) : tokens).join(" ").trim();
      const mode = idxMontant >= 0 ? tokens.slice(idxMontant + 1).join(" ").trim() : "";

      if (!q || isNaN(montant) || montant <= 0) {
        await msg.reply("Format : REACTIVER <nom ou code> <montant> [mode]\nEx : REACTIVER BODJONA 2000\nEx : REACTIVER BODJONA 2000 espèces");
        return;
      }

      const { status, data } = await appelReactiverGET(q, adminTel);
      if (status === 403) return; // pas un admin : on ignore en silence
      if (!data.ok) { await msg.reply("Erreur lors de la recherche. Réessaie."); return; }

      const matches = data.matches || [];
      if (matches.length === 0) {
        await msg.reply(`Aucun client trouvé pour « ${q} ».`);
        return;
      }
      if (matches.length > 1) {
        const liste = matches.slice(0, 8)
          .map((m) => `• ${m.nom} (code ${m.accessCode}) — expire le ${m.dateExpFr}`)
          .join("\n");
        await msg.reply(`Plusieurs clients correspondent :\n${liste}\n\nRenvoie avec le CODE, ex : REACTIVER ${matches[0].accessCode} ${montant}`);
        return;
      }

      const m = matches[0];
      const modeAffiche = mode || "Mix by Yas";
      pendings.set(adminTel, { id: m.id, nom: m.nom, montant, mode, newExpirationFr: m.newExpirationFr, expire: Date.now() + PENDING_TTL_MS });
      const avert = m.aNumero ? "" : "\n⚠️ Ce client n'a pas de numéro : il ne recevra pas la notification.";
      await msg.reply(
        `Trouvé : *${m.nom}* (code ${m.accessCode})\n` +
        `Expire le ${m.dateExpFr} → nouvelle échéance le *${m.newExpirationFr}*\n` +
        `Paiement : *${montant} F* (${modeAffiche})${avert}\n\n` +
        `Réponds *OUI* pour confirmer la réactivation.`
      );
      return;
    }

    // 1bis) Validation / rejet d'une dépense (réservé à l'admin principal).
    if (haut.startsWith("VALIDER") || haut.startsWith("REJETER")) {
      const estRejet = haut.startsWith("REJETER");
      const reste = texte.replace(/^(valider|rejeter)/i, "").trim();
      const toks = reste.split(/\s+/).filter(Boolean);
      const code = (toks[0] || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      const motif = toks.slice(1).join(" ").trim();
      if (!code) { await msg.reply("Format : VALIDER <code>  ou  REJETER <code> motif"); return; }
      if (estRejet && !motif) { await msg.reply(`Motif obligatoire pour rejeter.\nEx : REJETER ${code} trop cher`); return; }

      const res = await fetch(`${APP_URL}/api/depenses-validation?cle=${encodeURIComponent(CLE)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "decider", code, decision: estRejet ? "rejeter" : "valider", motif, admin_tel: adminTel }),
      });
      if (res.status === 403) return; // pas l'admin principal : on ignore en silence
      const data = await res.json().catch(() => ({}));
      if (!data.ok) {
        if (data.error === "introuvable") await msg.reply(`Aucune dépense en attente avec le code ${code}.`);
        else if (data.error === "motif_requis") await msg.reply("Motif obligatoire pour rejeter.");
        else await msg.reply("Erreur lors de la décision. Réessaie.");
        return;
      }
      // Notifie l'initiateur de la dépense (si numéro enregistré).
      if (data.initiator && data.initiator.telephone) {
        try {
          const cid = `${data.initiator.telephone}@c.us`;
          const ok = await client.isRegisteredUser(cid).catch(() => true);
          if (ok) await client.sendMessage(cid, data.initiator.message);
        } catch (e) { log("Notif initiateur échouée :", e.message); }
      }
      await msg.reply(data.adminConfirm || "Fait.");
      return;
    }

    // 2) Confirmation OUI / annulation NON — seulement s'il y a une demande en attente.
    const pend = pendings.get(adminTel);
    if (pend && Date.now() > pend.expire) { pendings.delete(adminTel); }
    const pend2 = pendings.get(adminTel);
    if (pend2) {
      if (haut === "OUI") {
        pendings.delete(adminTel);
        const { status, data } = await appelReactiverPOST(pend2.id, pend2.montant, pend2.mode, adminTel);
        if (status === 403) { await msg.reply("Action refusée : tu n'es pas autorisé."); return; }
        if (!data.ok) { await msg.reply("Échec de la réactivation. Réessaie ou vérifie dans l'app."); return; }
        // Notifie le client (si numéro) puis confirme à l'admin.
        let clientNotifie = false;
        const tel = data.client && data.client.telephone;
        if (tel) {
          try {
            const chatId = `${tel}@c.us`;
            const inscrit = await client.isRegisteredUser(chatId).catch(() => true);
            if (inscrit) {
              if (data.recuPdf) {
                // Envoie le reçu PDF en pièce jointe, avec le message en légende.
                const media = new MessageMedia("application/pdf", data.recuPdf, data.recuNom || "recu.pdf");
                await client.sendMessage(chatId, media, { caption: data.clientMessage });
              } else {
                await client.sendMessage(chatId, data.clientMessage);
              }
              clientNotifie = true;
            }
          } catch (e) { log("Réactivation : envoi au client échoué :", e.message); }
        }
        await msg.reply(
          `✅ *${data.client.nom}* réactivé jusqu'au *${data.client.newExpirationFr}*.\n` +
          `Paiement de ${pend2.montant} F (${data.mode || "Mix by Yas"}) enregistré dans la caisse.\n` +
          (clientNotifie ? "Le client a été notifié + reçu PDF envoyé." : "Client NON notifié (pas de numéro WhatsApp).")
        );
        log(`Réactivation : ${data.client.nom} jusqu'au ${data.client.newExpirationFr} (${pend2.montant} F)`);
        return;
      }
      if (haut === "NON" || haut === "ANNULER") {
        pendings.delete(adminTel);
        await msg.reply("Réactivation annulée.");
        return;
      }
    }
    // Tout autre message : on ne fait rien (support humain).
  } catch (e) {
    log("Erreur traitement message :", e.message);
  }
});

async function envoyerRappels() {
  log("Recherche des clients à notifier…");
  let data;
  try {
    const res = await fetch(`${APP_URL}/api/relance-whatsapp?cle=${encodeURIComponent(CLE)}`);
    data = await res.json();
    if (!data.ok) throw new Error(data.error || "réponse invalide du serveur");
  } catch (e) {
    log("Impossible de récupérer la liste :", e.message);
    return;
  }

  const clients = (data.clients || []).slice(0, MAX_PAR_RUN);
  if (clients.length === 0) {
    log("Aucun client à notifier aujourd'hui.");
    return;
  }
  log(`${clients.length} client(s) à notifier.`);

  const envoyes = [];
  for (const c of clients) {
    const chatId = `${c.telephone}@c.us`;
    try {
      // On vérifie que le numéro est bien sur WhatsApp avant d'envoyer : évite
      // les erreurs et réduit les signaux « robot ».
      const inscrit = await client.isRegisteredUser(chatId).catch(() => true);
      if (!inscrit) {
        log(`✗ ${c.nom} (${c.telephone}) n'est pas sur WhatsApp — ignoré.`);
        continue;
      }
      await client.sendMessage(chatId, c.message);
      envoyes.push(c.id);
      log(`✓ Envoyé à ${c.nom} (${c.telephone})`);
    } catch (e) {
      log(`✗ Échec pour ${c.nom} (${c.telephone}) :`, e.message);
    }
    await dodo(alea(DELAI_MIN, DELAI_MAX));
  }

  // Marque côté serveur les clients réellement relancés (pour ne pas les
  // renvoyer le même jour). Un client dont l'envoi a échoué n'est PAS marqué :
  // il sera retenté au prochain passage.
  if (envoyes.length) {
    try {
      await fetch(`${APP_URL}/api/relance-whatsapp?cle=${encodeURIComponent(CLE)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: envoyes }),
      });
      log(`${envoyes.length} client(s) marqué(s) comme relancé(s).`);
    } catch (e) {
      log("Envois réalisés mais marquage échoué :", e.message);
    }
  }
  log("Terminé.");
}

// Alertes à l'ÉQUIPE : nouveaux paiements / tickets / réclamations. Le serveur
// renvoie, pour chaque événement, le message et les numéros des membres
// concernés (selon leur rôle). On reste silencieux quand il n'y a rien.
async function envoyerAlertesEquipe() {
  let data;
  try {
    const res = await fetch(`${APP_URL}/api/alertes-equipe?cle=${encodeURIComponent(CLE)}`);
    data = await res.json();
    if (!data.ok) throw new Error(data.error || "réponse invalide du serveur");
  } catch (e) {
    log("Alertes équipe — impossible de récupérer :", e.message);
    return;
  }

  const events = data.events || [];
  if (events.length === 0) return; // rien de nouveau : on ne dit rien
  log(`${events.length} alerte(s) équipe à envoyer.`);

  const marks = [];
  for (const ev of events) {
    const dests = ev.recipients || [];
    let auMoinsUn = false;
    for (const tel of dests) {
      const chatId = `${tel}@c.us`;
      try {
        const inscrit = await client.isRegisteredUser(chatId).catch(() => true);
        if (!inscrit) { log(`✗ Équipe ${tel} n'est pas sur WhatsApp — ignoré.`); continue; }
        await client.sendMessage(chatId, ev.message);
        auMoinsUn = true;
        log(`✓ Alerte envoyée à l'équipe (${tel})`);
      } catch (e) {
        log(`✗ Alerte échouée pour ${tel} :`, e.message);
      }
      await dodo(alea(2000, 5000));
    }
    // Marque l'événement traité si au moins un envoi a réussi, ou s'il n'y avait
    // aucun destinataire (sinon il ressortirait à chaque passage).
    if (auMoinsUn || dests.length === 0) marks.push({ table: ev.table, id: ev.id });
  }

  if (marks.length) {
    try {
      await fetch(`${APP_URL}/api/alertes-equipe?cle=${encodeURIComponent(CLE)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marks }),
      });
    } catch (e) {
      log("Alertes envoyées mais marquage échoué :", e.message);
    }
  }
}

// Dépenses à faire valider : envoie à l'ADMIN PRINCIPAL un message par dépense
// en attente, avec les instructions VALIDER / REJETER.
async function envoyerValidations() {
  let data;
  try {
    const res = await fetch(`${APP_URL}/api/depenses-validation?cle=${encodeURIComponent(CLE)}`);
    data = await res.json();
    if (!data.ok) throw new Error(data.error || "réponse invalide");
  } catch (e) {
    log("Validations — récupération échouée :", e.message);
    return;
  }
  const events = data.events || [];
  if (events.length === 0) return;
  const adminTel = data.adminTel;
  if (!adminTel) { log("Validations : aucun admin principal avec numéro — rien envoyé."); return; }

  log(`${events.length} dépense(s) à faire valider par l'admin.`);
  const chatId = `${adminTel}@c.us`;
  const marks = [];
  for (const ev of events) {
    try {
      const inscrit = await client.isRegisteredUser(chatId).catch(() => true);
      if (!inscrit) { log(`✗ Admin ${adminTel} pas sur WhatsApp.`); break; }
      await client.sendMessage(chatId, ev.message);
      marks.push({ table: ev.table, id: ev.id });
      log(`✓ Dépense #${ev.code} envoyée à l'admin.`);
    } catch (e) {
      log(`✗ Envoi validation #${ev.code} échoué :`, e.message);
    }
    await dodo(alea(2000, 5000));
  }
  if (marks.length) {
    try {
      await fetch(`${APP_URL}/api/depenses-validation?cle=${encodeURIComponent(CLE)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "marquer", ids: marks }),
      });
    } catch (e) { log("Validations marquage échoué :", e.message); }
  }
}

log("Démarrage du robot WhatsApp APESPOT…");
client.initialize();
