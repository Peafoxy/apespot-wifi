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
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const cron = require("node-cron");

const APP_URL = (process.env.APP_URL || "https://apespot-wifi.vercel.app").replace(/\/+$/, "");
const CLE = process.env.CLE || "";
const HEURE = Math.min(23, Math.max(0, parseInt(process.env.HEURE_ENVOI || "8", 10) || 8));

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
  log(`Rappels clients : chaque jour à ${HEURE}h (heure de Lomé).`);
  log(`Alertes équipe : vérifiées toutes les ${ALERTE_INTERVALLE_MIN} min.`);
  // 1) Rappels d'abonnement aux clients, une fois par jour à l'heure choisie.
  cron.schedule(`0 ${HEURE} * * *`, () => {
    envoyerRappels().catch((e) => log("Erreur pendant l'envoi :", e.message));
  });
  // 2) Alertes à l'équipe (paiement / ticket / réclamation), régulièrement.
  cron.schedule(`*/${ALERTE_INTERVALLE_MIN} * * * *`, () => {
    envoyerAlertesEquipe().catch((e) => log("Erreur alertes équipe :", e.message));
  });
  // Option de test : « npm run test-envoi » lance tout de suite les deux.
  if (process.argv.includes("--maintenant")) {
    log("Option --maintenant : envoi immédiat (test).");
    envoyerRappels().catch((e) => log("Erreur pendant l'envoi :", e.message));
    envoyerAlertesEquipe().catch((e) => log("Erreur alertes équipe :", e.message));
  }
});

client.on("disconnected", (raison) => {
  log("Déconnecté de WhatsApp :", raison, "— tentative de reconnexion…");
  client.initialize().catch(() => {});
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

log("Démarrage du robot WhatsApp APESPOT…");
client.initialize();
