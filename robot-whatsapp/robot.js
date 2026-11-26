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
const fs = require("fs");

// Trouve un navigateur Chrome/Edge DÉJÀ installé sur le PC, pour éviter de
// dépendre du téléchargement automatique de Chrome par le robot (qui échoue sur
// certaines machines / connexions). On peut forcer un chemin via CHROME_PATH
// dans le fichier .env.
function fichierExiste(p) { try { return !!p && fs.existsSync(p); } catch { return false; } }
function trouverNavigateur() {
  if (fichierExiste(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const local = process.env.LOCALAPPDATA || "";
  const candidats = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    local && local + "\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);
  for (const p of candidats) if (fichierExiste(p)) return p;
  return null;
}
const NAVIGATEUR = trouverNavigateur();

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
// 5 min par défaut pour alléger les lectures Supabase (l'annonce d'un réabonnement
// aux autres admins arrive donc en ~5 min au lieu de ~3).
const ALERTE_INTERVALLE_MIN = Math.max(1, parseInt(process.env.ALERTE_INTERVALLE_MIN || "5", 10) || 5);

// Lecture active des commandes reçues (VALIDER, REACTIVER, OUI…) : intervalle en
// millisecondes. On lit nous-mêmes les conversations car, sur certains comptes
// WhatsApp (Business), les événements "message" ne se déclenchent pas.
const SONDAGE_MS = Math.max(5000, (parseInt(process.env.SONDAGE_SECONDES || "12", 10) || 12) * 1000);
// On ne traite que les messages récents (évite de rejouer un vieux « OUI »).
const SONDAGE_FENETRE_S = 15 * 60; // 15 minutes

function log(...a) { console.log(new Date().toLocaleString("fr-FR"), "-", ...a); }
function dodo(ms) { return new Promise((r) => setTimeout(r, ms)); }
function alea(a, b) { return Math.floor(a + Math.random() * (b - a)); }

if (!CLE) {
  log("ERREUR : la clé CLE n'est pas renseignée dans le fichier .env — arrêt.");
  process.exit(1);
}

if (NAVIGATEUR) log("Navigateur utilisé :", NAVIGATEUR);
else log("Aucun Chrome/Edge détecté — le robot utilisera le navigateur téléchargé (si présent).");

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: "./session" }),
  puppeteer: {
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    ...(NAVIGATEUR ? { executablePath: NAVIGATEUR } : {}),
  },
});

client.on("qr", (qr) => {
  console.log("\n>>> Scanne ce QR code avec le WhatsApp du téléphone APESPOT :");
  console.log("    WhatsApp  >  Appareils connectés  >  Lier un appareil\n");
  qrcode.generate(qr, { small: true });
});

client.on("authenticated", () => log("WhatsApp authentifié ✓"));
client.on("auth_failure", (m) => log("Échec d'authentification :", m));

client.on("ready", () => {
  log("Robot connecté et prêt ✓  [VERSION 7 : diffusions/campagnes activées (vérifiées toutes les 2 min)]");
  log(`Rappels clients : à ${HEURES.map((h) => h + "h").join(", ")} (heure de Lomé). Un client déjà relancé n'est pas renotifié.`);
  log(`Alertes équipe : vérifiées toutes les ${ALERTE_INTERVALLE_MIN} min.`);
  log(`Commandes (VALIDER/REJETER/REACTIVER/OUI) : lues toutes les ${Math.round(SONDAGE_MS / 1000)} s.`);
  // Lecture ACTIVE des messages reçus : certains comptes WhatsApp (Business /
  // multi-appareils) ne déclenchent pas les événements "message". On va donc
  // lire nous-mêmes les conversations récentes à intervalle régulier.
  setInterval(() => { sonderCommandes().catch((e) => log("Sondage échoué :", e.message)); }, SONDAGE_MS);
  setTimeout(() => { sonderCommandes().catch(() => {}); }, 4000); // premier passage rapide
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
  // 4) Diffusions (campagnes) composées dans l'app : vérifiées toutes les 2 min.
  cron.schedule("*/2 * * * *", () => {
    envoyerDiffusions().catch((e) => log("Erreur diffusion :", e.message));
  });
  // Option de test : « npm run test-envoi » lance tout de suite.
  if (process.argv.includes("--maintenant")) {
    log("Option --maintenant : envoi immédiat (test).");
    envoyerRappels().catch((e) => log("Erreur pendant l'envoi :", e.message));
    envoyerAlertesEquipe().catch((e) => log("Erreur alertes équipe :", e.message));
    envoyerValidations().catch((e) => log("Erreur validations :", e.message));
    envoyerDiffusions().catch((e) => log("Erreur diffusion :", e.message));
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
async function appelReactiverPOST(id, montant, mode, adminTel, force) {
  const corps = { id, montant, admin_tel: adminTel };
  if (mode) corps.mode = mode; // sinon le serveur met « Mix by Yas » par défaut
  if (force) corps.force = true; // confirme un réabonnement dans la fenêtre 1h-24h
  const res = await fetch(`${APP_URL}/api/reactiver?cle=${encodeURIComponent(CLE)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corps),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

// Diffuse le message de réabonnement aux autres admins (data.broadcast de l'API).
async function diffuserEquipe(broadcast) {
  if (!broadcast || !broadcast.message) return 0;
  const dests = broadcast.destinataires || [];
  let n = 0;
  for (const d of dests) {
    const tel = d && d.telephone;
    if (!tel) continue;
    const chatId = `${tel}@c.us`;
    try {
      const inscrit = await client.isRegisteredUser(chatId).catch(() => true);
      if (!inscrit) { log(`✗ Équipe ${tel} pas sur WhatsApp — ignoré.`); continue; }
      await client.sendMessage(chatId, broadcast.message);
      n++;
      log(`✓ Réabonnement annoncé à l'équipe (${tel})`);
    } catch (e) {
      log(`✗ Annonce équipe échouée pour ${tel} :`, e.message);
    }
    await dodo(alea(2000, 5000));
  }
  return n;
}

// On écoute À LA FOIS "message" ET "message_create" : selon le type de compte
// (WhatsApp Business, multi-appareils), l'un OU l'autre peut ne pas se déclencher
// pour les messages reçus. On branche le même traitement sur les deux et on
// déduplique par identifiant de message pour ne jamais traiter deux fois.
const messagesTraites = new Set();
// Résout le VRAI numéro de téléphone de l'expéditeur. Les comptes récents /
// Business reçoivent les messages avec un identifiant masqué @lid (ex.
// 114409456279581@lid) qui N'EST PAS le numéro : on le convertit via l'API
// interne de WhatsApp Web. Renvoie une suite de chiffres, ou "".
async function resoudreTelephone(msg) {
  try {
    if (msg.from && msg.from.endsWith("@c.us")) return msg.from.replace("@c.us", "").replace(/\D/g, "");
    const idBrut = msg.author || msg.from || "";
    try {
      const phone = await client.pupPage.evaluate(async (uid) => {
        const extraire = (p) => (p ? (p._serialized || p.user || (typeof p === "string" ? p : null)) : null);
        try {
          if (window.WWebJS && typeof window.WWebJS.enforceLidAndPnRetrieval === "function") {
            const r = await window.WWebJS.enforceLidAndPnRetrieval(uid);
            const v = extraire(r && r.phone);
            if (v) return v;
          }
        } catch (e) {}
        try {
          const wid = window.require("WAWebWidFactory").createWid(uid);
          const api = window.require("WAWebApiContact");
          const v = extraire(api && api.getPhoneNumber ? api.getPhoneNumber(wid) : null);
          if (v) return v;
        } catch (e) {}
        return null;
      }, idBrut);
      if (phone) return String(phone).replace(/@.*/, "").replace(/\D/g, "");
    } catch (e) {}
    // Repli : fiche contact (déjà résolue sur certaines versions).
    try {
      const c = await msg.getContact();
      return String((c && (c.number || (c.id && c.id.user))) || "").replace(/\D/g, "");
    } catch (e) {}
  } catch (e) {}
  return "";
}

async function traiterMessage(msg) {
  try {
    if (msg.fromMe) return;
    if (!msg.from) return;
    // On ignore les groupes et les diffusions ; on accepte les conversations
    // individuelles, qu'elles soient en @c.us ou en @lid (nouveau format des
    // comptes récents / Business).
    if (msg.from.endsWith("@g.us") || msg.from.endsWith("@broadcast") || msg.from.endsWith("@newsletter")) return;

    // Déduplication (si plusieurs sources signalent le même message).
    const mid = (msg.id && (msg.id._serialized || msg.id.id)) || `${msg.from}|${msg.timestamp}|${msg.body}`;
    if (messagesTraites.has(mid)) return;
    messagesTraites.add(mid);
    if (messagesTraites.size > 600) { let n = 0; for (const k of messagesTraites) { messagesTraites.delete(k); if (++n >= 200) break; } }

    const adminTel = await resoudreTelephone(msg);
    if (!adminTel) return;

    const texte = (msg.body || "").trim();
    const haut = texte.toUpperCase();
    log("📩 Message reçu de", adminTel, ":", JSON.stringify(texte.slice(0, 50)));
    if (!haut) return;

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
      const garde = m.garde || {};
      // Garde-fou < 1h : blocage ferme (sauf admin principal, géré côté serveur).
      if (garde.bloque) {
        await msg.reply(
          `⏳ *${m.nom}* vient d'être réabonné.\n` +
          `Réessaie dans ${garde.minutesLeft} min (ou via l'app par l'administrateur principal).`
        );
        return;
      }
      // Garde-fou 1h-24h : on avertit (qui / quand) ; le OUI confirme quand même
      // (force=true transmis au serveur).
      const avert = m.aNumero ? "" : "\n⚠️ Ce client n'a pas de numéro : il ne recevra pas la notification.";
      let avertDouble = "";
      if (garde.avertir) {
        const qui = garde.qui ? ` par ${garde.qui}` : "";
        const quand = garde.quandFr ? ` le ${garde.quandFr}` : "";
        avertDouble = `\n⚠️ Déjà réabonné${qui}${quand}. Confirme seulement si c'est bien un nouveau paiement.`;
      }
      pendings.set(adminTel, { id: m.id, nom: m.nom, montant, mode, newExpirationFr: m.newExpirationFr, force: !!garde.avertir, expire: Date.now() + PENDING_TTL_MS });
      await msg.reply(
        `Trouvé : *${m.nom}* (code ${m.accessCode})\n` +
        `Expire le ${m.dateExpFr} → nouvelle échéance le *${m.newExpirationFr}*\n` +
        `Paiement : *${montant} F* (${modeAffiche})${avert}${avertDouble}\n\n` +
        `Réponds *OUI* pour confirmer, ou *NON* pour annuler.`
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
      log(`${estRejet ? "REJETER" : "VALIDER"} ${code} → serveur HTTP ${res.status}`);
      if (res.status === 403) { await msg.reply("Validation réservée à l'administrateur principal."); return; }
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
        const { status, data } = await appelReactiverPOST(pend2.id, pend2.montant, pend2.mode, adminTel, pend2.force);
        if (status === 403) { await msg.reply("Action refusée : tu n'es pas autorisé."); return; }
        // Garde-fou serveur (sécurité) : blocage < 1h ou confirmation requise.
        if (status === 409 && data && data.error === "bloque_1h") {
          await msg.reply(`⏳ *${pend2.nom}* vient d'être réabonné. Réessaie dans ${data.minutesLeft} min.`);
          return;
        }
        if (status === 409 && data && data.error === "confirmation_requise") {
          const qui = data.qui ? ` par ${data.qui}` : "";
          const quand = data.quandFr ? ` le ${data.quandFr}` : "";
          pendings.set(adminTel, { ...pend2, force: true, expire: Date.now() + PENDING_TTL_MS });
          await msg.reply(`⚠️ *${pend2.nom}* a déjà été réabonné${qui}${quand}.\nRéponds *OUI* pour confirmer quand même, ou *NON* pour annuler.`);
          return;
        }
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
        // Diffusion immédiate à tous les autres admins (sauf l'auteur).
        let nbEquipe = 0;
        try { nbEquipe = await diffuserEquipe(data.broadcast); } catch (e) { log("Diffusion équipe échouée :", e.message); }
        await msg.reply(
          `✅ *${data.client.nom}* réactivé jusqu'au *${data.client.newExpirationFr}*.\n` +
          `Paiement de ${pend2.montant} F (${data.mode || "Mix by Yas"}) enregistré dans la caisse.\n` +
          (clientNotifie ? "Le client a été notifié + reçu PDF envoyé." : "Client NON notifié (pas de numéro WhatsApp).") +
          (nbEquipe > 0 ? `\n📣 ${nbEquipe} admin(s) informé(s).` : "")
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
}

// Le même traitement est branché sur les deux événements WhatsApp. Grâce à la
// déduplication par id ci-dessus, un message reçu une fois n'est traité qu'une fois.
client.on("message", (msg) => { traiterMessage(msg).catch((e) => log("Erreur message :", e.message)); });
client.on("message_create", (msg) => { traiterMessage(msg).catch((e) => log("Erreur message_create :", e.message)); });

// LECTURE ACTIVE (sondage) : indispensable pour les comptes WhatsApp Business,
// où les événements "message"/"message_create" ne se déclenchent pas pour les
// messages reçus. On lit les conversations individuelles les plus récentes et on
// traite les messages récents non encore vus (la déduplication évite les doublons
// avec les événements). Les droits sont vérifiés côté serveur, donc lire toutes
// les conversations récentes est sans danger.
let sondageEnCours = false;
async function sonderCommandes() {
  if (sondageEnCours) return; // évite les chevauchements si un passage est lent
  sondageEnCours = true;
  try {
    const maintenant = Math.floor(Date.now() / 1000);
    let chats = await client.getChats();
    // Conversations individuelles : @c.us OU @lid (les groupes @g.us sont exclus).
    const indiv = (chats || []).filter((c) => c && !c.isGroup && c.id && c.id._serialized &&
      (c.id._serialized.endsWith("@c.us") || c.id._serialized.endsWith("@lid")));
    const recents = indiv.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, 20);
    for (const chat of recents) {
      if (chat.timestamp && (maintenant - chat.timestamp) > SONDAGE_FENETRE_S) continue;
      const msgs = await chat.fetchMessages({ limit: 6 }).catch(() => []);
      for (const m of msgs) {
        if (!m) continue;
        if (m.timestamp && (maintenant - m.timestamp) > SONDAGE_FENETRE_S) continue;
        if (m.fromMe) continue;
        await traiterMessage(m); // la déduplication par id gère les répétitions
      }
    }
  } catch (e) {
    log("Lecture des commandes — erreur :", e.message);
  } finally {
    sondageEnCours = false;
  }
}

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

  let nbEnvoyes = 0;
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
      log(`✓ Envoyé à ${c.nom} (${c.telephone})`);
      // IMPORTANT : on marque « relancé » IMMÉDIATEMENT après l'envoi (un client
      // à la fois), avant même de passer au suivant. Ainsi, même si le robot est
      // coupé juste après, ce client ne recevra JAMAIS une seconde notification
      // le même jour — ni par le robot, ni proposé à un administrateur.
      try {
        await marquerRelance([c.id]);
        nbEnvoyes++;
      } catch (e) {
        log(`⚠ ${c.nom} : envoyé mais marquage « relancé » échoué (${e.message}) — risque de doublon.`);
      }
    } catch (e) {
      log(`✗ Échec pour ${c.nom} (${c.telephone}) :`, e.message);
    }
    await dodo(alea(DELAI_MIN, DELAI_MAX));
  }
  log(`Terminé. ${nbEnvoyes} client(s) notifié(s) et marqué(s) « relancé ».`);
}

// Marque une liste de clients comme « relancés aujourd'hui » côté serveur.
// Lève une erreur si le serveur ne confirme pas (pour pouvoir avertir d'un doublon possible).
async function marquerRelance(ids) {
  const r = await fetch(`${APP_URL}/api/relance-whatsapp?cle=${encodeURIComponent(CLE)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
}

// DIFFUSION (campagne) : l'admin principal a composé un message dans l'app pour
// une cible (tous / expirés / expire bientôt / à jour / par zone). On récupère
// les destinataires PAR LOTS et on envoie, avec pauses (anti-blocage WhatsApp).
// On continue lot après lot jusqu'à épuisement. Verrou pour ne pas lancer deux
// diffusions en parallèle.
let diffusionEnCours = false;
async function envoyerDiffusions() {
  if (diffusionEnCours) return;
  diffusionEnCours = true;
  try {
    while (true) {
      let data;
      try {
        const res = await fetch(`${APP_URL}/api/diffusion?cle=${encodeURIComponent(CLE)}`);
        data = await res.json();
        if (!data.ok) throw new Error(data.error || "réponse invalide du serveur");
      } catch (e) {
        log("Diffusion : liste indisponible :", e.message);
        return;
      }
      const clients = data.clients || [];
      if (!data.diffusionId || clients.length === 0) return; // rien à diffuser
      log(`Diffusion ${data.diffusionId} : lot de ${clients.length} (restants ~${data.total}).`);

      let nbMarques = 0;
      for (const c of clients) {
        const chatId = `${c.telephone}@c.us`;
        try {
          const inscrit = await client.isRegisteredUser(chatId).catch(() => true);
          if (!inscrit) {
            // Pas sur WhatsApp : on le marque quand même « envoyé » pour cette
            // campagne, sinon il serait renvoyé en boucle à chaque lot.
            log(`✗ ${c.nom} (${c.telephone}) n'est pas sur WhatsApp — ignoré.`);
            try { await marquerDiffusion(data.diffusionId, [c.id]); nbMarques++; } catch {}
            await dodo(alea(DELAI_MIN, DELAI_MAX));
            continue;
          }
          await client.sendMessage(chatId, c.message);
          // Marquage immédiat (un par un) : si le robot est coupé juste après,
          // ce client ne recevra pas le message deux fois.
          try { await marquerDiffusion(data.diffusionId, [c.id]); nbMarques++; }
          catch (e) { log(`⚠ ${c.nom} : envoyé mais marquage échoué (${e.message}) — risque de doublon.`); }
          log(`✓ Diffusion envoyée à ${c.nom} (${c.telephone})`);
        } catch (e) {
          log(`✗ Diffusion échec pour ${c.nom} (${c.telephone}) :`, e.message);
        }
        await dodo(alea(DELAI_MIN, DELAI_MAX));
      }

      // Aucun progrès sur tout un lot (ni envoi ni marquage) : on arrête pour ne
      // pas boucler indéfiniment (ex. serveur de marquage en panne).
      if (nbMarques === 0) {
        log("Diffusion : aucun progrès sur ce lot, arrêt (on reprendra plus tard).");
        return;
      }
      // sinon : on repart chercher le lot suivant.
    }
  } finally {
    diffusionEnCours = false;
  }
}

// Confirme au serveur l'envoi de clients pour UNE campagne (reprise sûre).
async function marquerDiffusion(id, ids) {
  const r = await fetch(`${APP_URL}/api/diffusion?cle=${encodeURIComponent(CLE)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, ids }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
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
