import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";

/**
 * Alerte Client WiFi — APESPOT WI-FI
 * Tableau de bord des abonnements WiFi (statut / jours restants) + suivi des paiements clients.
 *
 * Persistance : Supabase, via des appels fetch() directs à l'API REST (PostgREST) —
 * pas de dépendance à @supabase/supabase-js, donc ça marche à la fois dans l'aperçu
 * d'artefact de Claude et tel quel dans ton projet React, sans rien installer.
 * Voir le script SQL fourni séparément (wifi-schema.sql) pour créer les tables.
 *
 * Remplace SUPABASE_URL et SUPABASE_ANON_KEY par les valeurs de ton projet
 * (les mêmes que celles utilisées par BMI-Gestions Boutiques).
 *
 * MODE DÉMO AUTOMATIQUE : tant que SUPABASE_ANON_KEY n'est pas renseignée,
 * l'app fonctionne toute seule avec des données de démonstration sauvegardées
 * dans le navigateur (localStorage). Dès que tu colles ta vraie clé, elle
 * bascule automatiquement sur Supabase — aucun autre changement nécessaire.
 */

const SUPABASE_URL = "https://jtjqvlcryaeljcnhhrpv.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp0anF2bGNyeWFlbGpjbmhocnB2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM1Mzg2NjEsImV4cCI6MjA5OTExNDY2MX0.GbOgFkjbb8Rik1NQikrUFqGLmHDE_IwDt0zVoO3FCcQ";
const SUPABASE_CONFIGURED = Boolean(SUPABASE_ANON_KEY) && SUPABASE_ANON_KEY !== "COLLE_ICI_TA_CLE_ANON_PUBLIC";

const LOCAL_CLIENTS_KEY = "bmi-wifi-clients-demo";
const LOCAL_PAYMENTS_KEY = "bmi-wifi-payments-demo";
const LOCAL_MESSAGES_KEY = "bmi-wifi-messages-demo";
const LOCAL_COMPLAINTS_KEY = "bmi-wifi-complaints-demo";
const LOCAL_USERS_KEY = "bmi-wifi-users-demo";
const LOCAL_PAYMENT_REQUESTS_KEY = "bmi-wifi-payment-requests-demo";

function uid() {
  return "d_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Codes d'accès internes — utilisés uniquement pour créer le tout premier compte Admin/Technicien.
// Une fois connecté, gère les comptes depuis l'onglet "Utilisateurs".
const DEFAULT_ADMIN_PIN = "2580";
const SESSION_KEY = "apespot-wifi-session";
const INACTIVITY_LIMIT_MS = 2 * 60 * 1000; // déconnexion après 2 min d'inactivité
const DEFAULT_TECH_PIN = "1470";

// Code client déterministe : 4 derniers chiffres du téléphone + 2 premières lettres du nom.
function computeClientCode(nom, telephone) {
  const digits = (telephone || "").replace(/[^\d]/g, "");
  const last4 = digits ? digits.slice(-4).padStart(4, "0") : "0000";
  const letters = (nom || "").trim().toUpperCase().replace(/[^A-ZÀ-Ý]/g, "");
  const first2 = (letters.slice(0, 2) || "XX").padEnd(2, "X");
  return last4 + first2;
}

function generateUserPin() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

const LOGO_DATA_URI = "data:image/jpeg;base64,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";

async function sbFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase ${options.method || "GET"} ${path} — ${res.status} ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

const SEED_CLIENTS = [
  ["POROZI", "30 Mbps/10 000F", "2025-05-30"],
  ["CASH POWER", "CASH POWER", "2025-08-17"],
  ["MIPC TV1", "20 Mbps/10 000F", "2025-09-04"],
  ["DORIS", "20Mbps/8 000F", "2025-09-07"],
  ["BADAMELI", "30 Mbps/10 000F", "2025-09-25"],
  ["ADAM 55MIL", "22200060477355", "2025-10-07"],
  ["KETEVI", "20 Mbps/10 000F", "2025-12-02"],
  ["TGCOM ADAM 15 MIL", "22510423", "2026-01-30"],
  ["SEDDOR", "30 Mbps/15 000F", "2026-02-07"],
  ["ADJI", "20 Mbps/10 000F", "2026-02-10"],
  ["SEFORA", "31 Mbps/10 000F", "2026-02-11"],
  ["DOUTI", "29 Mbps/15 000F", "2026-02-15"],
  ["YACOUBOU", "31 Mbps/15 000F", "2026-02-25"],
  ["ALAIN", "30 Mbps/10 000F", "2026-03-03"],
  ["ISSIFOU", "5Mbps/8 000F", "2026-03-13"],
  ["DONNEE", "30 Mbps/10 000F", "2026-03-20"],
  ["KOUYOU", "30 Mbps/10 000F", "2026-03-26"],
  ["GABIN", "30 Mbps/10 000F", "2026-04-07"],
  ["AYEKPO", "30 Mbps/15 000F", "2026-04-11"],
  ["KPANDANG", "30 Mbps/10 000F", "2026-04-13"],
  ["CANALBOX BASE", "D779DFC0", "2026-05-18"],
  ["ADELLE", "20 Mbps/15 000F", "2026-04-24"],
  ["ANAHEA", "30 Mbps/15 000F", "2026-04-25"],
  ["AUSTIN", "30 Mbps/10 000F", "2026-04-26"],
  ["TCHALLA", "30 Mbps/15 000F", "2026-05-01"],
  ["OTOUDE", "30 Mbps/10 000F", "2026-05-01"],
  ["CONSTANCE", "30 Mbps/15 000F", "2026-05-03"],
  ["KOUWODO", "30 Mbps/10 000F", "2026-05-04"],
  ["NADEGE", "30 Mbps/15 000F", "2026-05-05"],
  ["GARBA", "20 Mbps/15 000F", "2026-05-07"],
  ["LAZARE", "5Mbps/8 000F", "2026-05-07"],
  ["AGO", "30 Mbps/15 000F", "2026-05-08"],
  ["YEVU", "20 Mbps/10 000F", "2026-05-08"],
  ["BOUKOU", "30 Mbps/10 000F", "2026-05-11"],
  ["TCHAYAO", "30 Mbps/15 000F", "2026-05-11"],
  ["AKARA", "30 Mbps/10 000F", "2026-05-11"],
  ["AMEWU", "20 Mbps/8 000F", "2026-05-11"],
  ["GOUDO", "30 Mbps/10 000F", "2026-05-12"],
  ["AGBLE", "30 Mbps/10 000F", "2026-05-12"],
  ["KPAMSSA", "30Mbps/10 000F", "2026-05-14"],
  ["GBAGUIDI", "30 Mbps/15 000F", "2026-05-15"],
  ["DELA", "20 Mbps/15 000F", "2026-05-15"],
  ["AKOMEDI", "30 Mbps/15 000F", "2026-05-15"],
  ["AWENA", "30 Mbps/10 000F", "2026-05-18"],
  ["BODJONA", "30 Mbps/10 000F", "2026-05-20"],
  ["MICHEL", "30 Mbps/15 000F", "2026-05-20"],
  ["BAKPA", "30 Mbps/10 000F", "2026-05-21"],
  ["FOULERA", "30 Mbps/10 000F", "2026-05-22"],
  ["FATI", "30 Mbps/15 000F", "2026-05-22"],
  ["PIERRE", "20 Mbps/10 000F", "2026-05-24"],
  ["JULIETTE", "30Mbps/10 000F", "2026-05-25"],
  ["TEBIE", "30 Mbps/15 000F", "2026-05-25"],
  ["LATEEF", "30 Mbps/10 000F", "2026-05-27"],
  ["SANDA", "30 Mbps/10 000F", "2026-05-27"],
  ["TEGNAMA", "30 Mbps/10 000F", "2026-05-28"],
  ["TGCOM BASE 30 MIL", "22534292", "2026-05-20"],
  ["TGCOM BASE 15 MIL", "22532910", "2026-05-28"],
  ["TGCOM BASE 2 15MIL", "22510092", "2026-05-29"],
  ["KITALA", "20 Mbps/15 000F", "2026-05-30"],
  ["TOGDJALA", "30 Mbps/15 000F", "2026-05-30"],
  ["MOUSTAFA 55MIL", "22200060481727", "2026-06-02"],
  ["DAGAN", "20 Mbps/10 000F", "2026-03-30"],
  ["AGBOGAH", "30 Mbps/10 000F", null],
  ["WOLOU", "30Mbps/10 000F", null],
  ["ESPOIR", "20 Mbps", null],
  ["HOME", "100 Mbps", null],
  ["ALVIN", "20 Mbps", null],
  ["BARTH", "20 Mbps", null],
  ["WIFIZONE", "20 Mbps", null],
  ["AVINATO", "20 Mbps", null],
  ["SYLVIE", "20 Mbps", null],
  ["SALEM", "20 Mbps", null],
].map(([nom, offre, dateExp]) => ({ nom, offre, telephone: null, dateExp }));

function todayMidnight() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function computeStatus(dateExp) {
  if (!dateExp) return { jours: null, statut: "NA", action: "—" };
  const exp = new Date(dateExp + "T00:00:00");
  if (isNaN(exp.getTime())) return { jours: null, statut: "NA", action: "Date invalide" };
  const jours = Math.round((exp - todayMidnight()) / 86400000);
  if (jours < 0) return { jours, statut: "EXPIRE", action: "déjà coupé" };
  if (jours === 0) return { jours, statut: "ATTENTION", action: "À COUPER" };
  if (jours <= 2) return { jours, statut: "ATTENTION", action: "2ème notification" };
  if (jours < 5) return { jours, statut: "ATTENTION", action: "Notifier" };
  return { jours, statut: "OK", action: "ok" };
}

function fmtDate(dateExp) {
  if (!dateExp) return "—";
  const d = new Date(dateExp + "T00:00:00");
  if (isNaN(d.getTime())) return "invalide";
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function fmtFCFA(n) {
  return (Number(n) || 0).toLocaleString("fr-FR") + " F";
}

function normalizePhone(raw) {
  let d = (raw || "").replace(/[^\d]/g, "");
  if (!d) return "";
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 8) return "228" + d; // numéro local togolais sans indicatif
  return d; // suppose que l'indicatif est déjà inclus
}

function buildWaMessage(c) {
  const { jours, statut } = computeStatus(c.dateExp);
  const dateTxt = fmtDate(c.dateExp);

  let statusLines;
  if (statut === "EXPIRE") {
    statusLines = `Votre abonnement WiFi APESPOT a *expiré le ${dateTxt}*\nMerci de renouveler pour rétablir votre connexion.`;
  } else if (statut === "ATTENTION") {
    statusLines = jours === 0
      ? `Votre abonnement WiFi APESPOT *expire aujourd'hui* (${dateTxt})\nMerci de renouveler rapidement pour éviter une coupure.`
      : `Votre abonnement WiFi APESPOT expire le *${dateTxt}* (dans ${jours} jour${jours > 1 ? "s" : ""})\nMerci de prévoir le renouvellement.`;
  } else if (statut === "OK") {
    statusLines = `Votre abonnement WiFi APESPOT est à jour jusqu'au *${dateTxt}*\nMerci de votre confiance !`;
  } else {
    statusLines = `Ceci est un message de APESPOT WI-FI concernant votre abonnement WiFi.`;
  }

  const closing = statut === "OK"
    ? "Accède à ton espace Pour discuter avec nous, payer ou faire une réclamation"
    : "Accède à ton espace pour payer ou soumettre une réclamation";

  const codeLine = c.accessCode ? `TON CODE : ${c.accessCode}` : "(demande ton code à APESPOT WI-FI)";

  return [
    `Bonjour ${c.nom}`,
    ``,
    statusLines,
    ``,
    `Click sur : `,
    ``,
    `https://apespot-wifi.vercel.app`,
    ``,
    `Vas sur *client* `,
    ``,
    codeLine,
    ``,
    closing,
  ].join("\n");
}

function loadLocal(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    /* ignore */
  }
  return fallback;
}

function saveLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    /* storage full or unavailable */
  }
}

// ---- Supabase mapping helpers (DB uses snake_case, app state uses camelCase) ----
const rowToClient = (r) => ({ id: r.id, nom: r.nom, offre: r.offre, telephone: r.telephone, dateExp: r.date_exp, accessCode: r.access_code });
const clientToRow = (c) => ({ nom: c.nom, offre: c.offre, telephone: c.telephone || null, date_exp: c.dateExp || null, access_code: c.accessCode || null });

const rowToPayment = (r) => ({
  id: r.id,
  clientNom: r.client_nom,
  montant: r.montant,
  mode: r.mode,
  date: r.date,
  newExpiration: r.new_expiration,
  note: r.note,
});
const paymentToRow = (p) => ({
  client_nom: p.clientNom,
  montant: p.montant,
  mode: p.mode,
  date: p.date,
  new_expiration: p.newExpiration || null,
  note: p.note || null,
});

const rowToMessage = (r) => ({ id: r.id, clientId: r.client_id, clientNom: r.client_nom, sender: r.sender, body: r.body, createdAt: r.created_at });
const messageToRow = (m) => ({ client_id: m.clientId || null, client_nom: m.clientNom, sender: m.sender, body: m.body });

const rowToUser = (r) => ({ id: r.id, nom: r.nom, role: r.role, pin: r.pin });
const userToRow = (u) => ({ nom: u.nom, role: u.role, pin: u.pin });

const rowToPaymentRequest = (r) => ({
  id: r.id,
  clientId: r.client_id,
  clientNom: r.client_nom,
  montant: r.montant,
  mode: r.mode,
  note: r.note,
  status: r.status,
  createdAt: r.created_at,
});
const paymentRequestToRow = (r) => ({
  client_id: r.clientId || null,
  client_nom: r.clientNom,
  montant: r.montant,
  mode: r.mode,
  note: r.note || null,
  status: r.status || "pending",
});

const rowToComplaint = (r) => ({
  id: r.id,
  clientId: r.client_id,
  clientNom: r.client_nom,
  reason: r.reason,
  dateDebut: r.date_debut,
  localisation: r.localisation,
  latitude: r.latitude,
  longitude: r.longitude,
  description: r.description,
  status: r.status,
  read: r.read ?? false,
  createdAt: r.created_at,
});
const complaintToRow = (c) => ({
  client_id: c.clientId || null,
  client_nom: c.clientNom,
  reason: c.reason,
  date_debut: c.dateDebut || null,
  localisation: c.localisation || null,
  latitude: c.latitude ?? null,
  longitude: c.longitude ?? null,
  description: c.description || null,
  status: c.status || "nouveau",
  read: c.read ?? false,
});

async function fetchClients() {
  const data = await sbFetch("wifi_clients?select=*&order=date_exp.asc.nullslast");
  if (data && data.length) return data.map(rowToClient);

  // Table vide : on importe les données de départ une seule fois.
  const seedRows = SEED_CLIENTS.map((c) => clientToRow(c));
  const inserted = await sbFetch("wifi_clients", { method: "POST", body: JSON.stringify(seedRows) });
  return (inserted || []).map(rowToClient);
}

async function fetchPayments() {
  const data = await sbFetch("wifi_payments?select=*&order=date.desc");
  return (data || []).map(rowToPayment);
}

async function fetchMessages() {
  const data = await sbFetch("wifi_messages?select=*&order=created_at.asc");
  return (data || []).map(rowToMessage);
}

async function fetchComplaints() {
  const data = await sbFetch("wifi_complaints?select=*&order=created_at.desc");
  return (data || []).map(rowToComplaint);
}

async function fetchUsers() {
  const data = await sbFetch("wifi_users?select=*&order=created_at.asc");
  if (data && data.length) return data.map(rowToUser);

  // Table vide : on crée un premier compte Admin et Technicien avec les codes par défaut.
  const seedRows = [
    { nom: "Admin", role: "admin", pin: DEFAULT_ADMIN_PIN },
    { nom: "Technicien", role: "technicien", pin: DEFAULT_TECH_PIN },
  ];
  const inserted = await sbFetch("wifi_users", { method: "POST", body: JSON.stringify(seedRows) });
  return (inserted || []).map(rowToUser);
}

async function fetchPaymentRequests() {
  const data = await sbFetch("wifi_payment_requests?select=*&order=created_at.desc");
  return (data || []).map(rowToPaymentRequest);
}

async function insertClientRow(c) {
  const data = await sbFetch("wifi_clients", { method: "POST", body: JSON.stringify(clientToRow(c)) });
  return rowToClient(data[0]);
}
async function updateClientRow(id, c) {
  await sbFetch(`wifi_clients?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(clientToRow(c)) });
}
async function deleteClientRow(id) {
  await sbFetch(`wifi_clients?id=eq.${id}`, { method: "DELETE" });
}

async function insertPaymentRow(p) {
  const data = await sbFetch("wifi_payments", { method: "POST", body: JSON.stringify(paymentToRow(p)) });
  return rowToPayment(data[0]);
}
async function updatePaymentRow(id, p) {
  await sbFetch(`wifi_payments?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(paymentToRow(p)) });
}
async function deletePaymentRow(id) {
  await sbFetch(`wifi_payments?id=eq.${id}`, { method: "DELETE" });
}

async function insertMessageRow(m) {
  const data = await sbFetch("wifi_messages", { method: "POST", body: JSON.stringify(messageToRow(m)) });
  return rowToMessage(data[0]);
}

async function insertComplaintRow(c) {
  const data = await sbFetch("wifi_complaints", { method: "POST", body: JSON.stringify(complaintToRow(c)) });
  return rowToComplaint(data[0]);
}
async function updateComplaintRow(id, patch) {
  await sbFetch(`wifi_complaints?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

async function insertUserRow(u) {
  const data = await sbFetch("wifi_users", { method: "POST", body: JSON.stringify(userToRow(u)) });
  return rowToUser(data[0]);
}
async function updateUserRow(id, u) {
  await sbFetch(`wifi_users?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(userToRow(u)) });
}
async function deleteUserRow(id) {
  await sbFetch(`wifi_users?id=eq.${id}`, { method: "DELETE" });
}

async function insertPaymentRequestRow(r) {
  const data = await sbFetch("wifi_payment_requests", { method: "POST", body: JSON.stringify(paymentRequestToRow(r)) });
  return rowToPaymentRequest(data[0]);
}
async function updatePaymentRequestRow(id, patch) {
  await sbFetch(`wifi_payment_requests?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

// -------------------- Small reusable bits --------------------

function SignalBars({ statut }) {
  const cls =
    statut === "EXPIRE" ? "red" : statut === "ATTENTION" ? "amber" : statut === "OK" ? "green" : "na";
  return (
    <span className={`signal ${cls}`}>
      <i /><i /><i /><i />
    </span>
  );
}

function Badge({ statut }) {
  return <span className={`badge ${statut}`}>{statut === "NA" ? "N/A" : statut}</span>;
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.39 1.26 4.81L2 22l5.42-1.36a9.87 9.87 0 0 0 4.62 1.15h.01c5.46 0 9.9-4.45 9.9-9.91C21.96 6.45 17.5 2 12.04 2Zm0 18.13c-1.5 0-2.93-.4-4.17-1.16l-.3-.18-3.22.81.86-3.13-.2-.32a8.16 8.16 0 0 1-1.25-4.35c0-4.53 3.69-8.22 8.24-8.22 4.53 0 8.22 3.69 8.22 8.22 0 4.54-3.69 8.33-8.18 8.33Zm4.52-6.16c-.25-.12-1.47-.72-1.7-.81-.23-.08-.39-.12-.56.13-.17.25-.64.81-.78.97-.14.17-.29.19-.53.06-.25-.12-1.05-.39-2-1.23-.74-.66-1.24-1.47-1.38-1.72-.15-.25-.02-.38.11-.51.11-.11.25-.29.37-.43.12-.15.16-.25.24-.42.08-.17.04-.31-.02-.44-.06-.12-.56-1.35-.77-1.85-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.44.06-.67.31-.23.25-.87.85-.87 2.08s.9 2.42 1.02 2.58c.13.17 1.77 2.7 4.29 3.79.6.26 1.07.42 1.43.53.6.19 1.15.16 1.58.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.08.15-1.18-.06-.1-.23-.16-.48-.28Z" />
    </svg>
  );
}

function DatePickerInput({ id, value, onChange }) {
  const ref = React.useRef(null);
  const openPicker = () => {
    if (ref.current && typeof ref.current.showPicker === "function") {
      try {
        ref.current.showPicker();
      } catch (e) {}
    }
  };
  const blockDigits = (e) => {
    // Only block actual digit typing, so Tab/Backspace/Delete/Arrow/Enter/Escape
    // still work and the native calendar (click or Alt+Down) still opens.
    if (/^[0-9]$/.test(e.key)) e.preventDefault();
  };
  return (
    <input
      ref={ref}
      id={id}
      type="date"
      style={{ cursor: "pointer" }}
      value={value || ""}
      onClick={openPicker}
      onFocus={openPicker}
      onKeyDown={blockDigits}
      onPaste={(e) => e.preventDefault()}
      onChange={onChange}
    />
  );
}

// -------------------- Login screen --------------------

function LoginScreen({ clients, users, complaints, onAdminLogin, onTechLogin, onClientLogin }) {
  const [selected, setSelected] = useState(null); // 'admin' | 'technicien' | 'client'
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(null);
  const [now, setNow] = useState(Date.now());

  const newComplaintsCount = complaints ? complaints.filter((c) => !c.read).length : 0;

  useEffect(() => {
    if (!lockedUntil) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [lockedUntil]);

  const isLocked = lockedUntil && now < lockedUntil;
  const lockSecondsLeft = isLocked ? Math.ceil((lockedUntil - now) / 1000) : 0;

  const pick = (role) => {
    setSelected(role);
    setError("");
    setValue("");
  };

  const submit = () => {
    if (isLocked) return;
    const v = value.trim();
    if (!v) return;
    if (selected === "admin" || selected === "technicien") {
      const match = users.find((u) => u.role === selected && u.pin === v);
      if (match) {
        setFailedAttempts(0);
        if (selected === "admin") onAdminLogin(match);
        else onTechLogin(match);
      } else {
        const attempts = failedAttempts + 1;
        setFailedAttempts(attempts);
        if (attempts >= 5) {
          setLockedUntil(Date.now() + 60000);
          setFailedAttempts(0);
          setError("Trop de tentatives. Réessaie dans 60 secondes.");
        } else {
          setError(`Code incorrect (${attempts}/5 tentatives).`);
        }
      }
    } else if (selected === "client") {
      const match = clients.find((c) => (c.accessCode || "").trim().toUpperCase() === v.toUpperCase());
      if (match) onClientLogin(match);
      else setError("Code introuvable. Vérifie auprès de APESPOT WI-FI.");
    }
  };

  return (
    <div className="wifi-app login-screen">
      <style>{CSS}</style>
      <div className="login-card">
        <div className="brand-mark brand-mark-logo" style={{ margin: "0 auto 18px" }}>
          <img src={LOGO_DATA_URI} alt="Apé Spot WiFi" />
        </div>
        <h1 style={{ textAlign: "center", marginBottom: 4, fontSize: 22, fontWeight: 700, color: "#FFE9A8", letterSpacing: ".2px" }}>APESPOT WI-FI</h1>
        <div className="sub" style={{ textAlign: "center", marginBottom: 26 }}>Choisis ton espace</div>

        {!selected && (
          <div className="login-roles">
            <button className="login-role-btn" onClick={() => pick("admin")}>
              <div className="lr-title">
                Admin
                {newComplaintsCount > 0 && <span className="tab-badge" style={{ marginLeft: 8 }}>{newComplaintsCount}</span>}
              </div>
              <div className="lr-sub">Gestion complète</div>
            </button>
            <button className="login-role-btn" onClick={() => pick("technicien")}>
              <div className="lr-title">Technicien</div>
              <div className="lr-sub">Messages & clients</div>
            </button>
            <button className="login-role-btn" onClick={() => pick("client")}>
              <div className="lr-title">Client</div>
              <div className="lr-sub">Mon espace</div>
            </button>
          </div>
        )}

        {selected && (
          <div className="login-form">
            <label>{selected === "client" ? "Ton code d'accès" : `Code d'accès ${selected === "admin" ? "Admin" : "Technicien"}`}</label>
            <input
              autoFocus
              style={{ letterSpacing: 3, textAlign: "center", fontFamily: "var(--mono)", fontWeight: 700, fontSize: 18, textTransform: "uppercase" }}
              type={selected === "client" ? "text" : "password"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              disabled={isLocked}
            />
            {isLocked && <div className="login-error">Trop de tentatives. Réessaie dans {lockSecondsLeft}s.</div>}
            {!isLocked && error && <div className="login-error">{error}</div>}
            <div className="modal-actions" style={{ marginTop: 18 }}>
              <button className="btn-cancel" onClick={() => setSelected(null)}>Retour</button>
              <button className="btn-save" onClick={submit} disabled={isLocked}>Entrer</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// -------------------- Technicien view --------------------

function TechnicienView({ clients, enrichedClients, messages, complaints, onSendMessage, onUpdateComplaintStatus, onMarkComplaintsRead, onLogout, authUser }) {
  const [tab, setTab] = useState("complaints");
  const [activeThreadClient, setActiveThreadClient] = useState(null);
  const [replyText, setReplyText] = useState("");

  const complaintsSorted = [...complaints].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  const newComplaintsCount = complaints.filter((c) => !c.read).length;

  const threads = useMemo(() => {
    const map = {};
    messages.forEach((m) => {
      const key = m.clientNom || "Inconnu";
      if (!map[key]) map[key] = [];
      map[key].push(m);
    });
    return Object.entries(map)
      .map(([nom, msgs]) => {
        const sorted = [...msgs].sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
        return { nom, msgs: sorted, last: sorted[sorted.length - 1] };
      })
      .sort((a, b) => (b.last?.createdAt || "").localeCompare(a.last?.createdAt || ""));
  }, [messages]);

  const unansweredThreadsCount = threads.filter((t) => t.last?.sender === "client").length;

  const activeThread = threads.find((t) => t.nom === activeThreadClient);

  const sendReply = () => {
    if (!replyText.trim() || !activeThread) return;
    const client = clients.find((c) => c.nom === activeThread.nom);
    onSendMessage(client?.id, activeThread.nom, "company", replyText);
    setReplyText("");
  };

  return (
    <div className="wifi-app">
      <style>{CSS}</style>
      <header>
        <div className="brand">
          <div className="brand-mark brand-mark-logo"><img src={LOGO_DATA_URI} alt="Apé Spot WiFi" /></div>
          <div><h1>APESPOT WI-FI</h1><div className="sub">Espace Technicien{authUser?.nom ? ` · ${authUser.nom}` : ""}</div></div>
        </div>
        <button className="logout-link" onClick={onLogout}>Déconnexion</button>
      </header>

      <div className="tabs">
        <button className={`tab ${tab === "complaints" ? "active" : ""}`} onClick={() => { setTab("complaints"); onMarkComplaintsRead(); }}>
          Réclamations{newComplaintsCount > 0 && <span className="tab-badge">{newComplaintsCount}</span>}
        </button>
        <button className={`tab ${tab === "messages" ? "active" : ""}`} onClick={() => { setTab("messages"); setActiveThreadClient(null); }}>
          Messages{unansweredThreadsCount > 0 && <span className="tab-badge">{unansweredThreadsCount}</span>}
        </button>
        <button className={`tab ${tab === "clients" ? "active" : ""}`} onClick={() => setTab("clients")}>Clients</button>
      </div>

      {tab === "complaints" && (
        <div className="view active">
          {complaintsSorted.length === 0 && <div className="empty">Aucune réclamation pour l'instant.</div>}
          {complaintsSorted.map((c) => (
            <div className="complaint-card" key={c.id}>
              <div className="complaint-top">
                <div className="complaint-client">{c.clientNom}</div>
                <select value={c.status} onChange={(e) => onUpdateComplaintStatus(c.id, e.target.value)} className={`status-select status-${c.status}`}>
                  <option value="nouveau">Nouveau</option>
                  <option value="en_cours">En cours</option>
                  <option value="resolu">Résolu</option>
                </select>
              </div>
              <div className="complaint-reason">{c.reason}</div>
              <div className="complaint-meta">
                {c.dateDebut && <span>Depuis le {fmtDate(c.dateDebut)}</span>}
                {c.localisation && <span> · {c.localisation}</span>}
              </div>
              {c.latitude && (
                <a href={`https://www.google.com/maps?q=${c.latitude},${c.longitude}`} target="_blank" rel="noreferrer" className="gps-view-link complaint-map-link">
                  📍 Voir la position sur la carte
                </a>
              )}
              {c.description && <div className="complaint-desc">{c.description}</div>}
              <div className="complaint-date">{c.createdAt ? new Date(c.createdAt).toLocaleString("fr-FR") : ""}</div>
            </div>
          ))}
        </div>
      )}

      {tab === "messages" && (
        <div className="view active">
          {!activeThreadClient ? (
            <>
              {threads.length === 0 && <div className="empty">Aucun message pour l'instant.</div>}
              {threads.map((t) => (
                <div key={t.nom} className="thread-row" onClick={() => setActiveThreadClient(t.nom)}>
                  <div className="thread-name">{t.nom}</div>
                  <div className="thread-preview">{t.last?.body}</div>
                </div>
              ))}
            </>
          ) : (
            <div className="thread-view">
              <button className="btn-cancel" onClick={() => setActiveThreadClient(null)} style={{ marginBottom: 12 }}>← Retour</button>
              <div className="thread-messages">
                {activeThread?.msgs.map((m) => (
                  <div key={m.id} className={`msg-bubble ${m.sender === "company" ? "msg-out" : "msg-in"}`}>{m.body}</div>
                ))}
              </div>
              <div className="thread-input">
                <input placeholder="Répondre..." value={replyText} onChange={(e) => setReplyText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendReply()} />
                <button className="btn-save" onClick={sendReply}>Envoyer</button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "clients" && (
        <div className="view active">
          <div className="client-list-scroll" style={{ maxHeight: "62vh" }}>
            {enrichedClients.map((c) => (
              <div className="client-row" key={c.id}>
                <div className="client-row-top">
                  <div className="client-row-left">
                    <SignalBars statut={c.statut} />
                    <span className="client-row-name">{c.nom}</span>
                  </div>
                  <Badge statut={c.statut} />
                </div>
                <div className="client-row-meta">
                  <span className="exp-date">{fmtDate(c.dateExp)}</span>
                  <span className="dot">·</span>
                  <span>{c.action}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <footer>Espace Technicien · liste clients en lecture seule</footer>
    </div>
  );
}

// -------------------- Client view --------------------

function ClientView({ client, clients, payments, paymentRequests, complaints, messages, onSendMessage, onAddComplaint, onSubmitPaymentRequest, onLogout }) {
  const [tab, setTab] = useState("home");
  const [complaintForm, setComplaintForm] = useState({ reason: "Connexion lente", dateDebut: "", localisation: "", description: "", latitude: null, longitude: null });
  const [payForm, setPayForm] = useState({ montant: "", mode: "Cash", note: "", codeSecret: "" });
  const [sentPayRequest, setSentPayRequest] = useState(false);
  const [payError, setPayError] = useState("");
  const [dialed, setDialed] = useState(false);
  const [msgText, setMsgText] = useState("");
  const [sentComplaint, setSentComplaint] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState("");

  const pendingPaymentKey = `apespot-wifi-pending-payment-${client.id}`;

  // Un paiement composé (montant + mode) mais pas encore envoyé (référence manquante) survit
  // à une déconnexion/reconnexion — seul le code secret n'est jamais conservé.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(pendingPaymentKey);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved && saved.dialed) {
          setPayForm({ montant: saved.montant || "", mode: saved.mode || "Cash", note: saved.note || "", codeSecret: "" });
          setDialed(true);
        }
      }
    } catch (e) { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      if (dialed && needsMobileMoney(payForm.mode)) {
        localStorage.setItem(pendingPaymentKey, JSON.stringify({ montant: payForm.montant, mode: payForm.mode, note: payForm.note, dialed: true }));
      } else {
        localStorage.removeItem(pendingPaymentKey);
      }
    } catch (e) { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialed, payForm.montant, payForm.mode, payForm.note]);

  const freshClient = clients.find((c) => c.id === client.id) || client;
  const { statut, action } = computeStatus(freshClient.dateExp);

  const myPayments = payments
    .filter((p) => (p.clientNom || "").trim().toLowerCase() === freshClient.nom.trim().toLowerCase())
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  const myPaymentRequests = paymentRequests
    .filter((r) => (r.clientNom || "").trim().toLowerCase() === freshClient.nom.trim().toLowerCase())
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  const myComplaints = (complaints || [])
    .filter((c) => (c.clientNom || "").trim().toLowerCase() === freshClient.nom.trim().toLowerCase())
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  const myMessages = messages
    .filter((m) => (m.clientNom || "").trim().toLowerCase() === freshClient.nom.trim().toLowerCase())
    .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));

  const submitComplaint = async () => {
    if (!complaintForm.reason) return;
    const ok = await onAddComplaint({
      clientId: freshClient.id,
      clientNom: freshClient.nom,
      reason: complaintForm.reason,
      dateDebut: complaintForm.dateDebut || null,
      localisation: complaintForm.localisation,
      latitude: complaintForm.latitude,
      longitude: complaintForm.longitude,
      description: complaintForm.description,
    });
    if (ok) {
      setSentComplaint(true);
      setComplaintForm({ reason: "Connexion lente", dateDebut: "", localisation: "", description: "", latitude: null, longitude: null });
      setLocError("");
      setTimeout(() => { setSentComplaint(false); setTab("home"); }, 2200);
    }
  };

  const composePayment = () => {
    setPayError("");
    if (!payForm.montant || Number(payForm.montant) <= 0) {
      setPayError("Indique un montant valide.");
      return;
    }
    if (!payForm.codeSecret.trim()) {
      setPayError("Le code secret Mobile Money est requis.");
      return;
    }
    const ussd = buildUssd(payForm.mode, payForm.montant, payForm.codeSecret);
    window.location.href = `tel:${ussd.replace("#", "%23")}`;
    setDialed(true);
  };

  const submitPayment = async () => {
    setPayError("");
    if (!payForm.montant || Number(payForm.montant) <= 0) {
      setPayError("Indique un montant valide.");
      return;
    }
    if (needsMobileMoney(payForm.mode) && !payForm.note.trim()) {
      setPayError("Ajoute la référence reçue par SMS après le paiement — elle est obligatoire pour Flooz et Mix by Yas.");
      return;
    }

    const ok = await onSubmitPaymentRequest(freshClient.id, freshClient.nom, Number(payForm.montant), payForm.mode, payForm.note);
    if (ok) {
      setSentPayRequest(true);
      setDialed(false);
      setPayForm({ montant: "", mode: "Cash", note: "", codeSecret: "" });
      setTimeout(() => { setSentPayRequest(false); setTab("home"); }, 2200);
    }
  };

  // Codes USSD de paiement marchand — construits localement, jamais affichés ni envoyés à APESPOT WI-FI.
  const buildUssd = (mode, montant, codeSecret) => {
    if (mode === "Flooz") return `*155*1*1*99968488*99968488*${montant}*1*${codeSecret}#`;
    if (mode === "Mix by Yas") return `*145*1*${montant}*1*${codeSecret}*92285325*1*${codeSecret}#`;
    return "";
  };
  const needsMobileMoney = (mode) => mode === "Flooz" || mode === "Mix by Yas";

  const resetPaymentForm = () => {
    setPayForm({ montant: "", mode: "Cash", note: "", codeSecret: "" });
    setDialed(false);
    setPayError("");
    setTab("home");
  };

  const captureLocation = () => {
    if (!navigator.geolocation) {
      setLocError("La géolocalisation n'est pas disponible sur cet appareil.");
      return;
    }
    setLocating(true);
    setLocError("");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setComplaintForm((f) => ({ ...f, latitude: pos.coords.latitude, longitude: pos.coords.longitude }));
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        setLocError(err.code === 1 ? "Autorisation refusée. Active la localisation pour ce site, ou décris l'endroit manuellement." : "Impossible de récupérer ta position. Réessaie ou décris l'endroit manuellement.");
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const sendMsg = () => {
    if (!msgText.trim()) return;
    onSendMessage(freshClient.id, freshClient.nom, "client", msgText);
    setMsgText("");
  };

  return (
    <div className="wifi-app">
      <style>{CSS}</style>
      <header>
        <div className="brand">
          <div className="brand-mark brand-mark-logo"><img src={LOGO_DATA_URI} alt="Apé Spot WiFi" /></div>
          <div><h1>APESPOT WI-FI</h1><div className="sub">Bonjour {freshClient.nom}</div></div>
        </div>
        <button className="logout-link" onClick={onLogout}>Déconnexion</button>
      </header>

      <div className="tabs">
        <button className={`tab ${tab === "home" ? "active" : ""}`} onClick={() => setTab("home")}>Mon compte</button>
        <button className={`tab ${tab === "messages" ? "active" : ""}`} onClick={() => setTab("messages")}>Message</button>
      </div>

      {tab === "home" && (
        <div className="view active">
          <div className="chart-card">
            <div className="ctitle">MON ABONNEMENT</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{freshClient.offre || "—"}</div>
                <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 4 }}>Expire le {fmtDate(freshClient.dateExp)}</div>
              </div>
              <Badge statut={statut} />
            </div>
            <div className="action-text">{action}</div>
          </div>

          <div className="button-row">
            <button className="btn-add" style={{ flex: 1, justifyContent: "center" }} onClick={() => setTab("payment")}>
              Effectuer un paiement
            </button>
            <button className="btn-add btn-report" style={{ flex: 1, justifyContent: "center" }} onClick={() => setTab("complaint")}>
              Faire une réclamation
            </button>
          </div>

          {dialed && needsMobileMoney(payForm.mode) && (
            <div className="call-reminder" style={{ cursor: "pointer" }} onClick={() => setTab("payment")}>
              📞 Tu as un paiement {payForm.mode} composé en attente de référence — appuie ici pour continuer.
            </div>
          )}

          {myPaymentRequests.length > 0 && (
            <div className="chart-card">
              <div className="ctitle">MES DEMANDES DE PAIEMENT</div>
              {myPaymentRequests.map((r) => (
                <div key={r.id} className="rah-item">
                  <span className="rah-date">{r.createdAt ? new Date(r.createdAt).toLocaleDateString("fr-FR") : ""}</span>
                  <span className={`badge ${r.status === "pending" ? "ATTENTION" : r.status === "accepted" ? "OK" : "EXPIRE"}`}>
                    {r.status === "pending" ? "En attente" : r.status === "accepted" ? "Acceptée" : "Refusée"}
                  </span>
                  <span className="rah-amount">{fmtFCFA(r.montant)}</span>
                </div>
              ))}
            </div>
          )}

          {myComplaints.length > 0 && (
            <div className="chart-card">
              <div className="ctitle">MES RÉCLAMATIONS</div>
              {myComplaints.map((c) => (
                <div key={c.id} className="rah-item">
                  <span className="rah-date">{c.createdAt ? new Date(c.createdAt).toLocaleDateString("fr-FR") : ""}</span>
                  <span>{c.reason}</span>
                  <span className={`badge ${c.status === "nouveau" ? "ATTENTION" : c.status === "en_cours" ? "ATTENTION" : "OK"}`}>
                    {c.status === "nouveau" ? "Nouveau" : c.status === "en_cours" ? "En cours" : "Résolu"}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="chart-card">
            <div className="ctitle">HISTORIQUE DES PAIEMENTS</div>
            {myPayments.length === 0 && <div className="empty" style={{ padding: "20px 0" }}>Aucun paiement enregistré.</div>}
            {myPayments.map((p) => (
              <div key={p.id} className="rah-item">
                <span className="rah-date">{fmtDate(p.date)}</span>
                <span>{p.mode}</span>
                <span className="rah-amount">{fmtFCFA(p.montant)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "payment" && (
        <div className="view active">
          <div className="chart-card">
            <div className="ctitle">EFFECTUER UN PAIEMENT</div>
            {sentPayRequest ? (
              <div style={{ textAlign: "center", padding: "20px 0", color: "var(--green)", fontWeight: 700 }}>
                Demande envoyée ✓ — en attente de validation par APESPOT WI-FI
              </div>
            ) : (
              <>
                <div className="field">
                  <label>Montant (FCFA)</label>
                  <input
                    type="number" min="0" step="1" placeholder="Ex: 10000"
                    value={payForm.montant}
                    onChange={(e) => { setPayForm({ ...payForm, montant: e.target.value }); setDialed(false); }}
                    disabled={dialed}
                  />
                </div>
                <div className="field">
                  <label>Mode de paiement</label>
                  <select value={payForm.mode} onChange={(e) => { setPayForm({ ...payForm, mode: e.target.value }); setDialed(false); setPayError(""); }} disabled={dialed}>
                    <option value="Cash">Cash</option>
                    <option value="Mix by Yas">Mix by Yas</option>
                    <option value="Flooz">Flooz</option>
                    <option value="Virement">Virement</option>
                    <option value="Autre">Autre</option>
                  </select>
                </div>

                {needsMobileMoney(payForm.mode) && !dialed && (
                  <>
                    <div className="field">
                      <label>Code secret Mobile Money</label>
                      <input
                        type="password"
                        inputMode="numeric"
                        placeholder="Ton code secret"
                        value={payForm.codeSecret}
                        onChange={(e) => setPayForm({ ...payForm, codeSecret: e.target.value })}
                      />
                      <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 6 }}>
                        Ton code secret ne quitte jamais ton téléphone — il n'est ni enregistré ni envoyé à APESPOT WI-FI.
                      </div>
                    </div>
                    {payError && <div className="login-error" style={{ textAlign: "left", marginBottom: 10 }}>{payError}</div>}
                    <div className="modal-actions">
                      <button className="btn-cancel" onClick={resetPaymentForm}>Annuler</button>
                      <button className="btn-save" onClick={composePayment}>Composer le paiement</button>
                    </div>
                  </>
                )}

                {needsMobileMoney(payForm.mode) && dialed && (
                  <>
                    <div className="gps-captured" style={{ marginBottom: 10 }}>
                      <div className="gps-captured-info"><span className="gps-dot">●</span> Paiement composé sur ton téléphone</div>
                      <button type="button" className="btn-cancel" style={{ padding: "6px 12px", fontSize: 11.5 }} onClick={composePayment}>Recomposer</button>
                    </div>
                    <div className="call-reminder">
                      📞 Appuie maintenant sur le bouton d'appel <strong>vert</strong> de ton téléphone pour valider le paiement.
                    </div>
                    <div className="field">
                      <label>Référence de la transaction (reçue par SMS)</label>
                      <input placeholder="Ex: FLZ2607131234" value={payForm.note} onChange={(e) => setPayForm({ ...payForm, note: e.target.value })} />
                      <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 6 }}>
                        Une fois le paiement confirmé par SMS, recopie ici la référence avant d'envoyer ta demande.
                      </div>
                    </div>
                    {payError && <div className="login-error" style={{ textAlign: "left", marginBottom: 10 }}>{payError}</div>}
                    <div className="modal-actions">
                      <button className="btn-cancel" onClick={resetPaymentForm}>Annuler</button>
                      <button className="btn-save" onClick={submitPayment}>Envoyer la demande</button>
                    </div>
                  </>
                )}

                {!needsMobileMoney(payForm.mode) && (
                  <>
                    <div className="field">
                      <label>Référence / note (optionnel)</label>
                      <input placeholder="Ex: référence de la transaction" value={payForm.note} onChange={(e) => setPayForm({ ...payForm, note: e.target.value })} />
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-faint)", marginBottom: 14 }}>
                      Ta demande sera envoyée à APESPOT WI-FI pour validation. Ton abonnement sera prolongé dès acceptation.
                    </div>
                    {payError && <div className="login-error" style={{ textAlign: "left", marginBottom: 10 }}>{payError}</div>}
                    <div className="modal-actions">
                      <button className="btn-cancel" onClick={resetPaymentForm}>Annuler</button>
                      <button className="btn-save" onClick={submitPayment}>Envoyer la demande</button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {tab === "complaint" && (
        <div className="view active">
          <div className="chart-card">
            <div className="ctitle">RÉCLAMATION</div>
            {sentComplaint ? (
              <div style={{ textAlign: "center", padding: "20px 0", color: "var(--green)", fontWeight: 700 }}>Réclamation envoyée ✓</div>
            ) : (
              <>
                <div className="field">
                  <label>Raison</label>
                  <select value={complaintForm.reason} onChange={(e) => setComplaintForm({ ...complaintForm, reason: e.target.value })}>
                    <option>Connexion lente</option>
                    <option>Connexion absente</option>
                    <option>Coupures fréquentes</option>
                    <option>Problème de paiement</option>
                    <option>Autre</option>
                  </select>
                </div>
                <div className="field">
                  <label>Date de début du problème</label>
                  <DatePickerInput value={complaintForm.dateDebut} onChange={(e) => setComplaintForm({ ...complaintForm, dateDebut: e.target.value })} />
                </div>
                <div className="field">
                  <label>Ta position</label>
                  {complaintForm.latitude ? (
                    <div className="gps-captured">
                      <div className="gps-captured-info">
                        <span className="gps-dot">●</span> Position enregistrée
                        <a
                          href={`https://www.google.com/maps?q=${complaintForm.latitude},${complaintForm.longitude}`}
                          target="_blank"
                          rel="noreferrer"
                          className="gps-view-link"
                        >
                          Voir sur la carte
                        </a>
                      </div>
                      <button type="button" className="btn-cancel" style={{ padding: "6px 12px", fontSize: 11.5 }} onClick={captureLocation}>
                        Actualiser
                      </button>
                    </div>
                  ) : (
                    <button type="button" className="btn-add" style={{ width: "100%", justifyContent: "center" }} onClick={captureLocation} disabled={locating}>
                      {locating ? "Localisation en cours..." : "📍 Utiliser ma position GPS"}
                    </button>
                  )}
                  {locError && <div className="login-error" style={{ textAlign: "left", marginTop: 8 }}>{locError}</div>}
                </div>
                <div className="field">
                  <label>Repère / précisions (optionnel)</label>
                  <input placeholder="Ex: Bè Klikamé, près du marché" value={complaintForm.localisation} onChange={(e) => setComplaintForm({ ...complaintForm, localisation: e.target.value })} />
                </div>
                <div className="field">
                  <label>Description (optionnel)</label>
                  <textarea placeholder="Détails supplémentaires..." value={complaintForm.description} onChange={(e) => setComplaintForm({ ...complaintForm, description: e.target.value })} />
                </div>
                <div className="modal-actions">
                  <button className="btn-cancel" onClick={() => setTab("home")}>Annuler</button>
                  <button className="btn-save" onClick={submitComplaint}>Envoyer</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {tab === "messages" && (
        <div className="view active">
          <div className="thread-view">
            <div className="thread-messages">
              {myMessages.length === 0 && <div className="empty">Aucun message. Écris à APESPOT WI-FI ci-dessous.</div>}
              {myMessages.map((m) => (
                <div key={m.id} className={`msg-bubble ${m.sender === "client" ? "msg-out" : "msg-in"}`}>{m.body}</div>
              ))}
            </div>
            <div className="thread-input">
              <input placeholder="Écris un message..." value={msgText} onChange={(e) => setMsgText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendMsg()} />
              <button className="btn-save" onClick={sendMsg}>Envoyer</button>
            </div>
          </div>
        </div>
      )}

      <footer>APESPOT WI-FI · votre espace client</footer>
    </div>
  );
}

// -------------------- Main component --------------------

export default function AlerteClientWifi() {
  // ---- Rôle / authentification (PIN partagé pour Admin/Technicien, code unique pour Client) ----
  const [role, setRole] = useState(null); // null | 'admin' | 'technicien' | 'client'
  const [authClient, setAuthClient] = useState(null); // fiche du client connecté (rôle 'client')
  const [authUser, setAuthUser] = useState(null); // compte connecté (rôle 'admin' ou 'technicien')
  const [sessionChecked, setSessionChecked] = useState(false); // évite un flash de l'écran de connexion pendant la restauration
  const lastActivityRef = useRef(Date.now());

  const [tab, setTab] = useState("dashboard");

  const [clients, setClients] = useState([]);
  const [payments, setPayments] = useState([]);
  const [messages, setMessages] = useState([]);
  const [complaints, setComplaints] = useState([]);
  const [users, setUsers] = useState([]);
  const [paymentRequests, setPaymentRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (!SUPABASE_CONFIGURED) {
      const demoClients = loadLocal(LOCAL_CLIENTS_KEY, null) || SEED_CLIENTS.map((c) => ({ ...c, id: uid() }));
      const demoPayments = loadLocal(LOCAL_PAYMENTS_KEY, []);
      const demoMessages = loadLocal(LOCAL_MESSAGES_KEY, []);
      const demoComplaints = loadLocal(LOCAL_COMPLAINTS_KEY, []);
      const demoPaymentRequests = loadLocal(LOCAL_PAYMENT_REQUESTS_KEY, []);
      const demoUsers = loadLocal(LOCAL_USERS_KEY, null) || [
        { id: uid(), nom: "Admin", role: "admin", pin: DEFAULT_ADMIN_PIN },
        { id: uid(), nom: "Technicien", role: "technicien", pin: DEFAULT_TECH_PIN },
      ];
      saveLocal(LOCAL_CLIENTS_KEY, demoClients);
      saveLocal(LOCAL_USERS_KEY, demoUsers);
      setClients(demoClients);
      setPayments(demoPayments);
      setMessages(demoMessages);
      setComplaints(demoComplaints);
      setUsers(demoUsers);
      setPaymentRequests(demoPaymentRequests);
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const [c, p, m, cp, u, pr] = await Promise.all([fetchClients(), fetchPayments(), fetchMessages(), fetchComplaints(), fetchUsers(), fetchPaymentRequests()]);
        setClients(c);
        setPayments(p);
        setMessages(m);
        setComplaints(cp);
        setUsers(u);
        setPaymentRequests(pr);
      } catch (e) {
        console.error(e);
        setLoadError("Connexion à Supabase impossible. Vérifie SUPABASE_URL / SUPABASE_ANON_KEY et les tables wifi_clients / wifi_payments / wifi_messages / wifi_complaints / wifi_users / wifi_payment_requests.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Rafraîchissement automatique en arrière-plan (toutes les 90s), pour voir les nouvelles
  // réclamations / messages / demandes sans recharger la page manuellement.
  useEffect(() => {
    if (!SUPABASE_CONFIGURED) return;
    const t = setInterval(async () => {
      try {
        const [c, p, m, cp, u, pr] = await Promise.all([fetchClients(), fetchPayments(), fetchMessages(), fetchComplaints(), fetchUsers(), fetchPaymentRequests()]);
        setClients(c);
        setPayments(p);
        setMessages(m);
        setComplaints(cp);
        setUsers(u);
        setPaymentRequests(pr);
      } catch (e) {
        console.error("Rafraîchissement automatique échoué:", e);
      }
    }, 90000);
    return () => clearInterval(t);
  }, []);

  // En mode démo (sans Supabase), on sauvegarde localement à chaque changement.
  useEffect(() => {
    if (!SUPABASE_CONFIGURED && !loading) saveLocal(LOCAL_CLIENTS_KEY, clients);
  }, [clients, loading]);
  useEffect(() => {
    if (!SUPABASE_CONFIGURED && !loading) saveLocal(LOCAL_PAYMENTS_KEY, payments);
  }, [payments, loading]);
  useEffect(() => {
    if (!SUPABASE_CONFIGURED && !loading) saveLocal(LOCAL_MESSAGES_KEY, messages);
  }, [messages, loading]);
  useEffect(() => {
    if (!SUPABASE_CONFIGURED && !loading) saveLocal(LOCAL_COMPLAINTS_KEY, complaints);
  }, [complaints, loading]);
  useEffect(() => {
    if (!SUPABASE_CONFIGURED && !loading) saveLocal(LOCAL_USERS_KEY, users);
  }, [users, loading]);
  useEffect(() => {
    if (!SUPABASE_CONFIGURED && !loading) saveLocal(LOCAL_PAYMENT_REQUESTS_KEY, paymentRequests);
  }, [paymentRequests, loading]);

  // ---------- Session persistante (survit à une actualisation) + déconnexion après inactivité ----------

  // Restaure la session sauvegardée une fois les données chargées (une seule fois).
  useEffect(() => {
    if (loading) return;
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        const session = JSON.parse(raw);
        const stillValid = session && session.role && (Date.now() - (session.lastActivity || 0) <= INACTIVITY_LIMIT_MS);
        if (stillValid) {
          if (session.role === "client") {
            const c = clients.find((x) => x.id === session.clientId);
            if (c) {
              lastActivityRef.current = Date.now();
              setAuthClient(c);
              setRole("client");
            }
          } else if (session.role === "admin" || session.role === "technicien") {
            const u = users.find((x) => x.id === session.userId) || null;
            lastActivityRef.current = Date.now();
            setAuthUser(u);
            setRole(session.role);
          }
        } else {
          localStorage.removeItem(SESSION_KEY);
        }
      }
    } catch (e) {
      console.error(e);
    }
    setSessionChecked(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // Sauvegarde la session à chaque connexion / changement de compte.
  useEffect(() => {
    if (!sessionChecked) return;
    if (!role) {
      localStorage.removeItem(SESSION_KEY);
      return;
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      role,
      userId: authUser?.id || null,
      clientId: authClient?.id || null,
      lastActivity: lastActivityRef.current,
    }));
  }, [role, authUser, authClient, sessionChecked]);

  // Suit l'activité de l'utilisateur et déconnecte après 2 minutes d'inactivité.
  useEffect(() => {
    if (!role) return;

    const bump = () => {
      lastActivityRef.current = Date.now();
      try {
        const raw = localStorage.getItem(SESSION_KEY);
        if (raw) {
          const session = JSON.parse(raw);
          session.lastActivity = lastActivityRef.current;
          localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        }
      } catch (e) { /* ignore */ }
    };

    const events = ["mousedown", "keydown", "touchstart", "scroll", "wheel"];
    events.forEach((ev) => window.addEventListener(ev, bump, { passive: true }));

    const interval = setInterval(() => {
      if (Date.now() - lastActivityRef.current > INACTIVITY_LIMIT_MS) {
        localStorage.removeItem(SESSION_KEY);
        setRole(null);
        setAuthUser(null);
        setAuthClient(null);
      }
    }, 5000);

    return () => {
      events.forEach((ev) => window.removeEventListener(ev, bump));
      clearInterval(interval);
    };
  }, [role]);

  // ---- Alerts view state ----
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [sortKey, setSortKey] = useState("jours");
  const [sortDir, setSortDir] = useState(1);
  const [clientModal, setClientModal] = useState(null); // null | { editingId, nom, offre, dateExp }
  const [userModal, setUserModal] = useState(null); // null | { editingId, nom, role, pin }
  const [rowActionsClient, setRowActionsClient] = useState(null); // client currently shown in the row-actions sheet

  // ---- Payments view state ----
  const [paySearch, setPaySearch] = useState("");
  const [modeFilter, setModeFilter] = useState("ALL");
  const [sortKeyP, setSortKeyP] = useState("date");
  const [sortDirP, setSortDirP] = useState(-1);
  const [paymentModal, setPaymentModal] = useState(null); // null | {editingId, clientNom, montant, mode, date, newExpiration, note}
  const [pendingRequestId, setPendingRequestId] = useState(null); // demande de paiement en cours de validation

  const [toast, setToast] = useState("");
  const [bilanOpen, setBilanOpen] = useState(false);
  const [bilanMonth, setBilanMonth] = useState(() => {
    const n = new Date();
    return n.getFullYear() + "-" + String(n.getMonth() + 1).padStart(2, "0");
  });
  const showToast = useCallback((msg) => {
    setToast(msg);
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setToast(""), 2400);
  }, []);

  // ---------- Derived data ----------
  const enrichedClients = useMemo(
    () => clients.map((c) => ({ ...c, ...computeStatus(c.dateExp) })),
    [clients]
  );

  const stats = useMemo(
    () => ({
      expire: enrichedClients.filter((c) => c.statut === "EXPIRE").length,
      attention: enrichedClients.filter((c) => c.statut === "ATTENTION").length,
      ok: enrichedClients.filter((c) => c.statut === "OK").length,
      total: enrichedClients.length,
    }),
    [enrichedClients]
  );

  const visibleClients = useMemo(() => {
    let rows = enrichedClients;
    if (filter !== "ALL") rows = rows.filter((c) => c.statut === filter);
    if (search.trim()) {
      const t = search.trim().toLowerCase();
      rows = rows.filter(
        (c) => c.nom.toLowerCase().includes(t) || (c.offre || "").toLowerCase().includes(t)
      );
    }
    rows = [...rows].sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey];
      if (sortKey === "jours") {
        av = av === null ? 9999999 : av;
        bv = bv === null ? 9999999 : bv;
      } else if (sortKey === "dateExp") {
        av = av || "9999-99-99";
        bv = bv || "9999-99-99";
      } else {
        av = (av || "").toString().toLowerCase();
        bv = (bv || "").toString().toLowerCase();
      }
      if (av < bv) return -1 * sortDir;
      if (av > bv) return 1 * sortDir;
      return 0;
    });
    return rows;
  }, [enrichedClients, filter, search, sortKey, sortDir]);

  const pendingRequests = useMemo(
    () => paymentRequests.filter((r) => r.status === "pending"),
    [paymentRequests]
  );

  const newComplaintsCount = useMemo(
    () => complaints.filter((c) => !c.read).length,
    [complaints]
  );

  const unresolvedComplaintsCount = useMemo(
    () => complaints.filter((c) => c.status !== "resolu").length,
    [complaints]
  );

  const clientsToCutToday = useMemo(
    () => enrichedClients.filter((c) => c.jours === 0),
    [enrichedClients]
  );

  const paymentStats = useMemo(() => {
    const now = new Date();
    const curMonthKey = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
    const total = payments.reduce((s, p) => s + (Number(p.montant) || 0), 0);
    const totalMonth = payments
      .filter((p) => p.date && p.date.startsWith(curMonthKey))
      .reduce((s, p) => s + (Number(p.montant) || 0), 0);
    const count = payments.length;
    const avg = count ? Math.round(total / count) : 0;
    return { total, totalMonth, count, avg };
  }, [payments]);

  const chartData = useMemo(() => {
    const now = new Date();
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        key: d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"),
        label: d.toLocaleDateString("fr-FR", { month: "short" }),
      });
    }
    const sums = months.map((m) =>
      payments.filter((p) => p.date && p.date.startsWith(m.key)).reduce((s, p) => s + (Number(p.montant) || 0), 0)
    );
    const max = Math.max(...sums, 1);
    return months.map((m, i) => ({ ...m, sum: sums[i], pct: Math.max(3, Math.round((sums[i] / max) * 100)) }));
  }, [payments]);

  const visiblePayments = useMemo(() => {
    let rows = payments;
    if (modeFilter !== "ALL") rows = rows.filter((p) => p.mode === modeFilter);
    if (paySearch.trim()) {
      const t = paySearch.trim().toLowerCase();
      rows = rows.filter(
        (p) => (p.clientNom || "").toLowerCase().includes(t) || (p.note || "").toLowerCase().includes(t)
      );
    }
    rows = [...rows].sort((a, b) => {
      let av = a[sortKeyP], bv = b[sortKeyP];
      if (sortKeyP === "montant") {
        av = Number(av) || 0;
        bv = Number(bv) || 0;
      } else {
        av = (av || "").toString().toLowerCase();
        bv = (bv || "").toString().toLowerCase();
      }
      if (av < bv) return -1 * sortDirP;
      if (av > bv) return 1 * sortDirP;
      return 0;
    });
    return rows;
  }, [payments, modeFilter, paySearch, sortKeyP, sortDirP]);

  // ---------- Client CRUD ----------
  const findClientByName = (nom) => {
    const t = (nom || "").trim().toLowerCase();
    return clients.find((c) => c.nom.trim().toLowerCase() === t) || null;
  };

  const openAddClient = () => setClientModal({ editingId: null, nom: "", offre: "", telephone: "", dateExp: "", accessCode: "" });
  const openEditClient = (c) =>
    setClientModal({ editingId: c.id, nom: c.nom, offre: c.offre || "", telephone: c.telephone || "", dateExp: c.dateExp || "", accessCode: c.accessCode || computeClientCode(c.nom, c.telephone || "") });
  const closeClientModal = () => setClientModal(null);

  const saveClientModal = async () => {
    const { editingId, nom, offre, telephone, dateExp, accessCode } = clientModal;
    if (!nom.trim()) return showToast("Le nom du client est requis.");
    const payload = { nom: nom.trim(), offre: offre.trim(), telephone: telephone.trim(), dateExp: dateExp || null, accessCode: (accessCode || "").trim().toUpperCase() };
    try {
      if (editingId) {
        if (SUPABASE_CONFIGURED) await updateClientRow(editingId, payload);
        setClients((cs) => cs.map((c) => (c.id === editingId ? { ...c, ...payload } : c)));
        showToast("Client mis à jour.");
      } else {
        const created = SUPABASE_CONFIGURED ? await insertClientRow(payload) : { id: uid(), ...payload };
        setClients((cs) => [...cs, created]);
        showToast("Client ajouté.");
        if (normalizePhone(created.telephone)) {
          sendWelcomeWhatsApp(created);
        } else {
          showToast("Ajoute un numéro WhatsApp pour envoyer le message de bienvenue.");
        }
      }
      closeClientModal();
    } catch (e) {
      console.error(e);
      showToast("Erreur d'enregistrement Supabase.");
    }
  };

  const sendWhatsApp = (c) => {
    const phone = normalizePhone(c.telephone);
    if (!phone) {
      showToast("Ajoute d'abord le numéro WhatsApp de ce client.");
      openEditClient(c);
      return;
    }
    const msg = buildWaMessage(c);
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank");
  };

  const buildWelcomeMessage = (c) => {
    const codeLine = c.accessCode ? `TON CODE : ${c.accessCode}` : "(demande ton code à APESPOT WI-FI)";
    return [
      `Bonjour ${c.nom}`,
      ``,
      `Bienvenue sur le réseau *APESPOT WI-FI* ! 🎉`,
      `Ton offre : ${c.offre || "—"}`,
      `Valable jusqu'au : *${fmtDate(c.dateExp)}*`,
      ``,
      `Click sur : `,
      ``,
      `https://apespot-wifi.vercel.app`,
      ``,
      `Vas sur *client* `,
      ``,
      codeLine,
      ``,
      `Accède à ton espace pour payer ou soumettre une réclamation`,
    ].join("\n");
  };

  const sendWelcomeWhatsApp = (c) => {
    const phone = normalizePhone(c.telephone);
    if (!phone) return;
    const msg = buildWelcomeMessage(c);
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank");
  };

  const deleteClient = async (c) => {
    if (window.confirm(`Supprimer "${c.nom}" de la liste ?`)) {
      try {
        if (SUPABASE_CONFIGURED) await deleteClientRow(c.id);
        setClients((cs) => cs.filter((x) => x.id !== c.id));
        showToast("Client supprimé.");
      } catch (e) {
        console.error(e);
        showToast("Erreur de suppression Supabase.");
      }
    }
  };

  // ---------- Payment CRUD ----------
  const openAddPayment = () =>
    setPaymentModal({
      editingId: null,
      clientNom: "",
      montant: "",
      mode: "Cash",
      date: new Date().toISOString().slice(0, 10),
      newExpiration: "",
      note: "",
    });
  const openEditPayment = (p) =>
    setPaymentModal({
      editingId: p.id,
      clientNom: p.clientNom || "",
      montant: p.montant || "",
      mode: p.mode || "Cash",
      date: p.date || "",
      newExpiration: p.newExpiration || "",
      note: p.note || "",
    });
  const closePaymentModal = () => { setPaymentModal(null); setPendingRequestId(null); };

  const onPaymentClientNameChange = (nom) => {
    setPaymentModal((pm) => {
      if (!pm) return pm;
      const c = findClientByName(nom);
      return { ...pm, clientNom: nom, newExpiration: c && c.dateExp ? c.dateExp : pm.newExpiration };
    });
  };

  const savePaymentModal = async () => {
    const { editingId, clientNom, montant, mode, date, newExpiration, note } = paymentModal;
    if (!clientNom.trim()) return showToast("Le nom du client est requis.");
    if (!montant || Number(montant) <= 0) return showToast("Le montant doit être supérieur à 0.");
    if (!date) return showToast("La date du paiement est requise.");

    const payload = {
      clientNom: clientNom.trim(),
      montant: Number(montant),
      mode,
      date,
      newExpiration: newExpiration || null,
      note: note.trim(),
    };

    try {
      if (editingId) {
        if (SUPABASE_CONFIGURED) await updatePaymentRow(editingId, payload);
        setPayments((ps) => ps.map((p) => (p.id === editingId ? { ...p, ...payload } : p)));
        showToast("Paiement mis à jour.");
      } else {
        const created = SUPABASE_CONFIGURED ? await insertPaymentRow(payload) : { id: uid(), ...payload };
        setPayments((ps) => [created, ...ps]);
        showToast("Paiement enregistré.");
      }

      if (newExpiration) {
        const c = findClientByName(clientNom);
        if (c) {
          if (SUPABASE_CONFIGURED) await updateClientRow(c.id, { nom: c.nom, offre: c.offre, dateExp: newExpiration });
          setClients((cs) => cs.map((x) => (x.id === c.id ? { ...x, dateExp: newExpiration } : x)));
          showToast("Paiement enregistré · abonnement WiFi prolongé.");
        } else {
          showToast("Paiement enregistré · client introuvable dans la liste WiFi.");
        }
      }

      if (pendingRequestId) {
        if (SUPABASE_CONFIGURED) await updatePaymentRequestRow(pendingRequestId, { status: "accepted" });
        setPaymentRequests((rs) => rs.map((r) => (r.id === pendingRequestId ? { ...r, status: "accepted" } : r)));
      }

      closePaymentModal();
    } catch (e) {
      console.error(e);
      showToast("Erreur d'enregistrement Supabase.");
    }
  };

  const deletePayment = async (p) => {
    if (window.confirm(`Supprimer le paiement de "${p.clientNom}" (${fmtFCFA(p.montant)}) ?`)) {
      try {
        if (SUPABASE_CONFIGURED) await deletePaymentRow(p.id);
        setPayments((ps) => ps.filter((x) => x.id !== p.id));
        showToast("Paiement supprimé.");
      } catch (e) {
        console.error(e);
        showToast("Erreur de suppression Supabase.");
      }
    }
  };

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => d * -1);
    else {
      setSortKey(key);
      setSortDir(1);
    }
  };
  const toggleSortP = (key) => {
    if (sortKeyP === key) setSortDirP((d) => d * -1);
    else {
      setSortKeyP(key);
      setSortDirP(1);
    }
  };

  const jourClass = (jours, statut) => {
    if (statut === "NA") return "na";
    if (jours < 0) return "neg";
    if (jours < 5) return "mid";
    return "pos";
  };

  const MODE_LABELS = ["Cash", "Mix by Yas", "Flooz", "Virement", "Autre"];

  const bilanData = useMemo(() => {
    const monthPayments = payments.filter((p) => p.date && p.date.startsWith(bilanMonth));
    const total = monthPayments.reduce((s, p) => s + (Number(p.montant) || 0), 0);
    const count = monthPayments.length;
    const avg = count ? Math.round(total / count) : 0;
    const byMode = MODE_LABELS.map((mode) => {
      const rows = monthPayments.filter((p) => (p.mode || "Autre") === mode);
      const sum = rows.reduce((s, p) => s + (Number(p.montant) || 0), 0);
      return { mode, sum, count: rows.length };
    }).filter((r) => r.count > 0);
    const sorted = [...monthPayments].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    const nbExpire = enrichedClients.filter((c) => c.statut === "EXPIRE").length;
    const nbAttention = enrichedClients.filter((c) => c.statut === "ATTENTION").length;
    const nbOk = enrichedClients.filter((c) => c.statut === "OK").length;
    return { total, count, avg, byMode, sorted, nbExpire, nbAttention, nbOk };
  }, [payments, bilanMonth, enrichedClients]);

  const bilanMonthLabel = useMemo(() => {
    const [y, m] = bilanMonth.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  }, [bilanMonth]);

  const openBilan = () => setBilanOpen(true);
  const closeBilan = () => setBilanOpen(false);
  const printBilan = () => window.print();

  const loyaltyStats = useMemo(() => {
    const totalClients = clients.length;
    const expired = enrichedClients.filter((c) => c.statut === "EXPIRE").length;
    const activeRate = totalClients ? Math.round(((totalClients - expired) / totalClients) * 100) : 0;

    const paymentsByClient = {};
    payments.forEach((p) => {
      const key = (p.clientNom || "").trim().toLowerCase();
      if (!key) return;
      paymentsByClient[key] = (paymentsByClient[key] || 0) + 1;
    });
    const clientsWithPayment = Object.keys(paymentsByClient).length;
    const clientsRenewed = Object.values(paymentsByClient).filter((n) => n >= 2).length;
    const renewalRate = clientsWithPayment ? Math.round((clientsRenewed / clientsWithPayment) * 100) : 0;

    return { activeRate, renewalRate };
  }, [clients, enrichedClients, payments]);

  // ---------- Export CSV ----------
  const downloadCSV = (filename, rows) => {
    const csv = rows
      .map((r) => r.map((v) => {
        const s = String(v ?? "");
        return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(";"))
      .join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Export CSV téléchargé.");
  };

  const exportClientsCSV = () => {
    const header = ["Client", "Offre", "Téléphone", "Date expiration", "Jours restants", "Statut", "Action"];
    const rows = [header, ...clients.map((c) => {
      const { jours, statut, action } = computeStatus(c.dateExp);
      return [c.nom, c.offre || "", c.telephone || "", c.dateExp || "", jours === null ? "" : jours, statut, action];
    })];
    downloadCSV(`clients_apespot_${new Date().toISOString().slice(0, 10)}.csv`, rows);
  };

  const exportPaymentsCSV = () => {
    const header = ["Client", "Montant", "Mode", "Date", "Nouvelle expiration", "Note"];
    const rows = [header, ...payments.map((p) => [p.clientNom || "", p.montant || 0, p.mode || "", p.date || "", p.newExpiration || "", p.note || ""])];
    downloadCSV(`paiements_apespot_${new Date().toISOString().slice(0, 10)}.csv`, rows);
  };

  const exportComplaintsCSV = () => {
    const header = ["Client", "Raison", "Date de début", "Localisation", "Latitude", "Longitude", "Description", "Statut", "Créée le"];
    const rows = [header, ...complaints.map((c) => [
      c.clientNom || "", c.reason || "", c.dateDebut || "", c.localisation || "",
      c.latitude ?? "", c.longitude ?? "", c.description || "", c.status || "",
      c.createdAt ? new Date(c.createdAt).toLocaleString("fr-FR") : "",
    ])];
    downloadCSV(`reclamations_apespot_${new Date().toISOString().slice(0, 10)}.csv`, rows);
  };

  // ---------- Relance groupée (bulk WhatsApp) ----------
  const [bulkQueue, setBulkQueue] = useState([]);
  const [bulkIndex, setBulkIndex] = useState(0);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkSkippedNoPhone, setBulkSkippedNoPhone] = useState(0);

  const openBulkNotify = () => {
    const atRisk = enrichedClients.filter((c) => c.statut === "EXPIRE" || c.statut === "ATTENTION");
    const withPhone = atRisk.filter((c) => normalizePhone(c.telephone));
    if (atRisk.length === 0) { showToast("Aucun client à risque actuellement. 🎉"); return; }
    if (withPhone.length === 0) { showToast("Aucun de ces clients n'a de numéro WhatsApp enregistré."); return; }
    setBulkQueue(withPhone);
    setBulkIndex(0);
    setBulkSkippedNoPhone(atRisk.length - withPhone.length);
    setBulkOpen(true);
  };
  const closeBulk = () => setBulkOpen(false);
  const bulkSendCurrent = () => {
    const c = bulkQueue[bulkIndex];
    if (c) sendWhatsApp(c);
    setBulkIndex((n) => n + 1);
  };
  const bulkSkipCurrent = () => setBulkIndex((n) => n + 1);

  // ---------- Messagerie & réclamations (partagées entre rôles) ----------
  const sendMessageHandler = async (clientId, clientNom, sender, body) => {
    if (!body.trim()) return;
    const payload = { clientId, clientNom, sender, body: body.trim() };
    try {
      const created = SUPABASE_CONFIGURED
        ? await insertMessageRow(payload)
        : { id: uid(), ...payload, createdAt: new Date().toISOString() };
      setMessages((ms) => [...ms, created]);
    } catch (e) {
      console.error(e);
      showToast("Erreur d'envoi du message.");
    }
  };

  const addComplaintHandler = async (complaintData) => {
    const payload = { ...complaintData, status: "nouveau", read: false };
    try {
      const created = SUPABASE_CONFIGURED
        ? await insertComplaintRow(payload)
        : { id: uid(), ...payload, createdAt: new Date().toISOString() };
      setComplaints((cs) => [created, ...cs]);
      return true;
    } catch (e) {
      console.error(e);
      showToast("Erreur d'envoi de la réclamation.");
      return false;
    }
  };

  const updateComplaintStatusHandler = async (id, status) => {
    try {
      if (SUPABASE_CONFIGURED) await updateComplaintRow(id, { status });
      setComplaints((cs) => cs.map((c) => (c.id === id ? { ...c, status } : c)));
    } catch (e) {
      console.error(e);
      showToast("Erreur de mise à jour du statut.");
    }
  };

  const markComplaintsReadHandler = async () => {
    const unreadIds = complaints.filter((c) => !c.read).map((c) => c.id);
    if (unreadIds.length === 0) return;
    try {
      if (SUPABASE_CONFIGURED) {
        await sbFetch(`wifi_complaints?id=in.(${unreadIds.join(",")})`, { method: "PATCH", body: JSON.stringify({ read: true }) });
      }
      setComplaints((cs) => cs.map((c) => (unreadIds.includes(c.id) ? { ...c, read: true } : c)));
    } catch (e) {
      console.error(e);
    }
  };

  // ---------- Demandes de paiement initiées par le client ----------
  const submitPaymentRequestHandler = async (clientId, clientNom, montant, mode, note) => {
    const payload = { clientId, clientNom, montant, mode, note, status: "pending" };
    try {
      const created = SUPABASE_CONFIGURED
        ? await insertPaymentRequestRow(payload)
        : { id: uid(), ...payload, createdAt: new Date().toISOString() };
      setPaymentRequests((rs) => [created, ...rs]);
      return true;
    } catch (e) {
      console.error(e);
      showToast("Erreur d'envoi de la demande de paiement.");
      return false;
    }
  };

  // L'admin ouvre le formulaire de paiement pré-rempli à partir de la demande du client.
  const acceptPaymentRequest = (req) => {
    const c = findClientByName(req.clientNom);
    setPendingRequestId(req.id);
    setPaymentModal({
      editingId: null,
      clientNom: req.clientNom,
      montant: req.montant,
      mode: req.mode,
      date: new Date().toISOString().slice(0, 10),
      newExpiration: c && c.dateExp ? c.dateExp : "",
      note: req.note || "",
    });
  };

  const rejectPaymentRequest = async (req) => {
    if (!window.confirm(`Refuser la demande de paiement de "${req.clientNom}" (${fmtFCFA(req.montant)}) ?`)) return;
    try {
      if (SUPABASE_CONFIGURED) await updatePaymentRequestRow(req.id, { status: "rejected" });
      setPaymentRequests((rs) => rs.map((r) => (r.id === req.id ? { ...r, status: "rejected" } : r)));
      showToast("Demande refusée.");
    } catch (e) {
      console.error(e);
      showToast("Erreur de mise à jour de la demande.");
    }
  };

  // ---------- Gestion des utilisateurs (Admin / Technicien) ----------
  const openAddUser = () => setUserModal({ editingId: null, nom: "", role: "technicien", pin: generateUserPin() });
  const openEditUser = (u) => setUserModal({ editingId: u.id, nom: u.nom, role: u.role, pin: u.pin });
  const closeUserModal = () => setUserModal(null);

  const saveUserModal = async () => {
    const { editingId, nom, role, pin } = userModal;
    if (!nom.trim()) return showToast("Le nom est requis.");
    if (!pin.trim()) return showToast("Le code PIN est requis.");
    const payload = { nom: nom.trim(), role, pin: pin.trim() };
    try {
      if (editingId) {
        if (SUPABASE_CONFIGURED) await updateUserRow(editingId, payload);
        setUsers((us) => us.map((u) => (u.id === editingId ? { ...u, ...payload } : u)));
        showToast("Utilisateur mis à jour.");
      } else {
        const created = SUPABASE_CONFIGURED ? await insertUserRow(payload) : { id: uid(), ...payload };
        setUsers((us) => [...us, created]);
        showToast("Utilisateur créé.");
      }
      closeUserModal();
    } catch (e) {
      console.error(e);
      showToast("Erreur d'enregistrement Supabase.");
    }
  };

  const deleteUser = async (u) => {
    if (u.role === "admin" && users.filter((x) => x.role === "admin").length <= 1) {
      showToast("Impossible de supprimer le dernier compte Admin.");
      return;
    }
    if (window.confirm(`Supprimer l'utilisateur "${u.nom}" ?`)) {
      try {
        if (SUPABASE_CONFIGURED) await deleteUserRow(u.id);
        setUsers((us) => us.filter((x) => x.id !== u.id));
        showToast("Utilisateur supprimé.");
      } catch (e) {
        console.error(e);
        showToast("Erreur de suppression Supabase.");
      }
    }
  };

  const handleLogout = () => {
    localStorage.removeItem(SESSION_KEY);
    setRole(null);
    setAuthClient(null);
    setAuthUser(null);
  };

  const today = todayMidnight();

  if (loading || !sessionChecked) {
    return (
      <div className="wifi-app">
        <style>{CSS}</style>
        <div className="empty">Chargement des données Supabase…</div>
      </div>
    );
  }

  if (!role) {
    return (
      <LoginScreen
        clients={clients}
        users={users}
        complaints={complaints}
        onAdminLogin={(u) => { setAuthUser(u); setRole("admin"); }}
        onTechLogin={(u) => { setAuthUser(u); setRole("technicien"); }}
        onClientLogin={(c) => { setAuthClient(c); setRole("client"); }}
      />
    );
  }

  if (role === "technicien") {
    return (
      <TechnicienView
        clients={clients}
        enrichedClients={enrichedClients}
        messages={messages}
        complaints={complaints}
        onSendMessage={sendMessageHandler}
        onUpdateComplaintStatus={updateComplaintStatusHandler}
        onMarkComplaintsRead={markComplaintsReadHandler}
        onLogout={handleLogout}
        authUser={authUser}
      />
    );
  }

  if (role === "client") {
    return (
      <ClientView
        client={authClient}
        clients={clients}
        payments={payments}
        paymentRequests={paymentRequests}
        complaints={complaints}
        messages={messages}
        onSendMessage={sendMessageHandler}
        onAddComplaint={addComplaintHandler}
        onSubmitPaymentRequest={submitPaymentRequestHandler}
        onLogout={handleLogout}
      />
    );
  }

  return (
    <div className="wifi-app">
      <style>{CSS}</style>
      {loadError && <div className="chart-card" style={{ borderColor: "var(--red)", color: "var(--red)" }}>{loadError}</div>}
      {!SUPABASE_CONFIGURED && !loadError && (
        <div className="chart-card" style={{ borderColor: "var(--amber)", color: "var(--amber)", fontSize: 12.5 }}>
          Mode démo local — les données sont sauvegardées dans ce navigateur uniquement. Ajoute ta clé SUPABASE_ANON_KEY avant de déployer pour utiliser la vraie base de données.
        </div>
      )}

      <header>
        <div className="brand">
          <div className="brand-mark brand-mark-logo">
            <img src={LOGO_DATA_URI} alt="Apé Spot WiFi" />
          </div>
          <div>
            <h1>APESPOT WI-FI</h1>
            <div className="sub">Gestion des clients</div>
          </div>
        </div>
        <div className="today-box">
          <span className="label">Aujourd'hui</span>
          <span className="val">
            {today.toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}
          </span>
          <button className="logout-link logout-inline" onClick={handleLogout}>Déconnexion</button>
        </div>
      </header>

      <div className="tabs">
        <button className={`tab ${tab === "dashboard" ? "active" : ""}`} onClick={() => setTab("dashboard")}>
          Tableau de bord
        </button>
        <button className={`tab ${tab === "alerts" ? "active" : ""}`} onClick={() => setTab("alerts")}>
          Alertes WiFi
        </button>
        <button className={`tab ${tab === "payments" ? "active" : ""}`} onClick={() => setTab("payments")}>
          Paiements{pendingRequests.length > 0 && <span className="tab-badge">{pendingRequests.length}</span>}
        </button>
        <button className={`tab ${tab === "complaints" ? "active" : ""}`} onClick={() => { setTab("complaints"); markComplaintsReadHandler(); }}>
          Réclamations{newComplaintsCount > 0 && <span className="tab-badge">{newComplaintsCount}</span>}
        </button>
        <button className={`tab ${tab === "users" ? "active" : ""}`} onClick={() => setTab("users")}>
          Utilisateurs
        </button>
      </div>

      {tab === "dashboard" && (
        <div className="view active">
          <div className="stats">
            <div className="stat expire"><div className="n">{clientsToCutToday.length}</div><div className="l">Clients à couper aujourd'hui</div></div>
            <div className="stat attention"><div className="n">{pendingRequests.length}</div><div className="l">Paiements en attente</div></div>
            <div className="stat ok"><div className="n">{unresolvedComplaintsCount}</div><div className="l">Réclamations non résolues</div></div>
            <div className="stat total"><div className="n">{stats.total}</div><div className="l">Total clients</div></div>
          </div>

          {clientsToCutToday.length > 0 && (
            <div className="chart-card" style={{ borderColor: "var(--red)" }}>
              <div className="ctitle" style={{ color: "var(--red)" }}>À COUPER AUJOURD'HUI ({clientsToCutToday.length})</div>
              {clientsToCutToday.map((c) => (
                <div key={c.id} className="rah-item" style={{ cursor: "pointer" }} onClick={() => { setTab("alerts"); setRowActionsClient(c); }}>
                  <span>{c.nom}</span>
                  <span className="exp-date">{c.offre || "—"}</span>
                  <Badge statut={c.statut} />
                </div>
              ))}
            </div>
          )}

          {pendingRequests.length > 0 && (
            <div className="chart-card" style={{ borderColor: "var(--amber)" }}>
              <div className="ctitle" style={{ color: "var(--amber)" }}>DEMANDES DE PAIEMENT EN ATTENTE ({pendingRequests.length})</div>
              {pendingRequests.map((r) => (
                <div key={r.id} className="rah-item">
                  <span>{r.clientNom}</span>
                  <span>{r.mode}</span>
                  <span className="rah-amount" style={{ color: "var(--amber)" }}>{fmtFCFA(r.montant)}</span>
                </div>
              ))}
              <button className="btn-cancel" style={{ width: "100%", marginTop: 10 }} onClick={() => setTab("payments")}>Voir dans Paiements →</button>
            </div>
          )}

          {unresolvedComplaintsCount > 0 && (
            <div className="chart-card">
              <div className="ctitle">RÉCLAMATIONS NON RÉSOLUES ({unresolvedComplaintsCount})</div>
              {complaints.filter((c) => c.status !== "resolu").slice(0, 5).map((c) => (
                <div key={c.id} className="rah-item">
                  <span>{c.clientNom}</span>
                  <span>{c.reason}</span>
                  <span className="badge ATTENTION">{c.status === "nouveau" ? "Nouveau" : "En cours"}</span>
                </div>
              ))}
              <button className="btn-cancel" style={{ width: "100%", marginTop: 10 }} onClick={() => { setTab("complaints"); markComplaintsReadHandler(); }}>Voir dans Réclamations →</button>
            </div>
          )}

          {clientsToCutToday.length === 0 && pendingRequests.length === 0 && unresolvedComplaintsCount === 0 && (
            <div className="empty">Rien à traiter pour l'instant — tout est à jour 🎉</div>
          )}
        </div>
      )}

      {tab === "alerts" && (
        <div className="view active">
          <div className="stats">
            <div className="stat expire"><div className="n">{stats.expire}</div><div className="l">Expirés</div></div>
            <div className="stat attention"><div className="n">{stats.attention}</div><div className="l">À surveiller</div></div>
            <div className="stat ok"><div className="n">{stats.ok}</div><div className="l">À jour</div></div>
            <div className="stat total"><div className="n">{stats.total}</div><div className="l">Total clients</div></div>
          </div>

          <div className="toolbar">
            <div className="search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
              <input placeholder="Rechercher un client..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="chips">
              {["ALL", "EXPIRE", "ATTENTION", "OK"].map((f) => (
                <button key={f} className={`chip ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>
                  {f === "ALL" ? "Tous" : f === "EXPIRE" ? "Expiré" : f === "ATTENTION" ? "Attention" : "OK"}
                </button>
              ))}
            </div>
            <button className="btn-add" onClick={openAddClient}>
              <svg viewBox="0 0 24 24" fill="none" stroke="#08201C" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
              Nouveau client
            </button>
            <button className="btn-add btn-report" onClick={openBulkNotify}>
              <svg viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2.4" strokeLinecap="round"><path d="M3 11l18-8-8 18-2-8-8-2Z" /></svg>
              Relance groupée
            </button>
            <button className="btn-add btn-report" onClick={exportClientsCSV}>
              <svg viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2.4" strokeLinecap="round"><path d="M12 3v12M7 10l5 5 5-5" /><path d="M4 19h16" /></svg>
              Export CSV
            </button>
          </div>

          <div className="table-shell client-list-shell">
            <div className="client-list-header">
              <span onClick={() => toggleSort("nom")}>Client</span>
              <span onClick={() => toggleSort("jours")}>Jours · Statut</span>
            </div>
            <div className="client-list-scroll">
              <div>
                {visibleClients.map((c) => {
                  const jc = jourClass(c.jours, c.statut);
                  const actionCls = c.statut === "EXPIRE" ? "urgent" : c.statut === "ATTENTION" ? "warn" : "";
                  return (
                    <div key={c.id} className="client-row row-clickable" onClick={() => setRowActionsClient(c)}>
                      <div className="client-row-top">
                        <div className="client-row-left">
                          <SignalBars statut={c.statut} />
                          <span className="client-row-name">{c.nom}</span>
                        </div>
                        <Badge statut={c.statut} />
                      </div>
                      <div className="client-row-meta">
                        <span className={`jours ${jc}`}>{c.jours === null ? "—" : (c.jours > 0 ? "+" : "") + c.jours + " j"}</span>
                        <span className="dot">·</span>
                        <span className="exp-date">{fmtDate(c.dateExp)}</span>
                        <span className="dot">·</span>
                        <span className={`action-text ${actionCls}`}>{c.action}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              {visibleClients.length === 0 && <div className="empty">Aucun client ne correspond à ce filtre.</div>}
            </div>
          </div>
        </div>
      )}

      {tab === "payments" && (
        <div className="view active">
          {pendingRequests.length > 0 && (
            <div className="chart-card" style={{ borderColor: "var(--amber)" }}>
              <div className="ctitle" style={{ color: "var(--amber)" }}>DEMANDES DE PAIEMENT EN ATTENTE ({pendingRequests.length})</div>
              {pendingRequests.map((r) => (
                <div key={r.id} className="request-row">
                  <div>
                    <div className="request-client">{r.clientNom}</div>
                    <div className="request-meta">{fmtFCFA(r.montant)} · {r.mode}{r.note ? ` · ${r.note}` : ""}</div>
                  </div>
                  <div className="request-actions">
                    <button className="row-action-btn del" style={{ padding: "8px 12px" }} onClick={() => rejectPaymentRequest(r)}>Refuser</button>
                    <button className="row-action-btn wa" style={{ padding: "8px 12px", color: "var(--green)" }} onClick={() => acceptPaymentRequest(r)}>Accepter</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="stats">
            <div className="stat total"><div className="n">{fmtFCFA(paymentStats.total)}</div><div className="l">Total encaissé</div></div>
            <div className="stat ok"><div className="n">{fmtFCFA(paymentStats.totalMonth)}</div><div className="l">Ce mois-ci</div></div>
            <div className="stat attention"><div className="n">{paymentStats.count}</div><div className="l">Paiements enregistrés</div></div>
            <div className="stat expire"><div className="n">{fmtFCFA(paymentStats.avg)}</div><div className="l">Montant moyen</div></div>
          </div>

          <div className="chart-card">
            <div className="ctitle">ENCAISSEMENTS DES 6 DERNIERS MOIS</div>
            <div className="chart-bars">
              {chartData.map((m) => (
                <div className="chart-col" key={m.key}>
                  <div className="cval">{m.sum ? Math.round(m.sum / 1000) + "k" : ""}</div>
                  <div className="bar" style={{ height: m.pct }} />
                  <div className="clabel">{m.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="chart-card">
            <div className="ctitle">FIDÉLITÉ CLIENTS</div>
            <div className="loyalty-row">
              <div className="loyalty-item">
                <div className="loyalty-val">{loyaltyStats.activeRate}%</div>
                <div className="loyalty-label">Clients actifs (non expirés)</div>
              </div>
              <div className="loyalty-item">
                <div className="loyalty-val loyalty-green">{loyaltyStats.renewalRate}%</div>
                <div className="loyalty-label">Taux de renouvellement</div>
              </div>
            </div>
          </div>

          <div className="toolbar">
            <div className="search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
              <input placeholder="Rechercher un paiement..." value={paySearch} onChange={(e) => setPaySearch(e.target.value)} />
            </div>
            <div className="chips">
              {["ALL", "Cash", "Mix by Yas", "Flooz", "Virement"].map((m) => (
                <button key={m} className={`chip ${modeFilter === m ? "active" : ""}`} onClick={() => setModeFilter(m)}>
                  {m === "ALL" ? "Tous" : m}
                </button>
              ))}
            </div>
            <button className="btn-add" onClick={openAddPayment}>
              <svg viewBox="0 0 24 24" fill="none" stroke="#08201C" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
              Enregistrer un paiement
            </button>
            <button className="btn-add btn-report" onClick={openBilan}>
              <svg viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2.4" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /><path d="M9 15h6M9 11h2" /></svg>
              Bilan mensuel (PDF)
            </button>
            <button className="btn-add btn-report" onClick={exportPaymentsCSV}>
              <svg viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2.4" strokeLinecap="round"><path d="M12 3v12M7 10l5 5 5-5" /><path d="M4 19h16" /></svg>
              Export CSV
            </button>
          </div>

          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th onClick={() => toggleSortP("clientNom")}>Client</th>
                  <th onClick={() => toggleSortP("montant")}>Montant</th>
                  <th onClick={() => toggleSortP("mode")}>Mode</th>
                  <th onClick={() => toggleSortP("date")}>Date</th>
                  <th>Nouvelle expiration</th>
                  <th>Note</th>
                  <th style={{ textAlign: "right" }}>Gérer</th>
                </tr>
              </thead>
              <tbody>
                {visiblePayments.map((p) => (
                  <tr key={p.id}>
                    <td className="client-name">{p.clientNom || "—"}</td>
                    <td className="jours pos">{fmtFCFA(p.montant)}</td>
                    <td><span className="badge OK">{p.mode || "—"}</span></td>
                    <td className="exp-date">{fmtDate(p.date)}</td>
                    <td className="exp-date">{p.newExpiration ? fmtDate(p.newExpiration) : "—"}</td>
                    <td className="action-text">{p.note || "—"}</td>
                    <td>
                      <div className="row-actions">
                        <button className="icon-btn" title="Modifier" onClick={() => openEditPayment(p)}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                        </button>
                        <button className="icon-btn del" title="Supprimer" onClick={() => deletePayment(p)}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {visiblePayments.length === 0 && <div className="empty">Aucun paiement enregistré pour l'instant.</div>}
          </div>
        </div>
      )}

      {tab === "complaints" && (
        <div className="view active">
          <div className="toolbar">
            <div style={{ fontSize: 12.5, color: "var(--text-dim)" }}>
              {complaints.length} réclamation(s) au total · {newComplaintsCount} nouvelle(s)
            </div>
            <button className="btn-add btn-report" onClick={exportComplaintsCSV}>
              <svg viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2.4" strokeLinecap="round"><path d="M12 3v12M7 10l5 5 5-5" /><path d="M4 19h16" /></svg>
              Export CSV
            </button>
          </div>
          {complaints.length === 0 && <div className="empty">Aucune réclamation pour l'instant.</div>}
          {[...complaints].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")).map((c) => (
            <div className="complaint-card" key={c.id}>
              <div className="complaint-top">
                <div className="complaint-client">{c.clientNom}</div>
                <select value={c.status} onChange={(e) => updateComplaintStatusHandler(c.id, e.target.value)} className={`status-select status-${c.status}`}>
                  <option value="nouveau">Nouveau</option>
                  <option value="en_cours">En cours</option>
                  <option value="resolu">Résolu</option>
                </select>
              </div>
              <div className="complaint-reason">{c.reason}</div>
              <div className="complaint-meta">
                {c.dateDebut && <span>Depuis le {fmtDate(c.dateDebut)}</span>}
                {c.localisation && <span> · {c.localisation}</span>}
              </div>
              {c.latitude && (
                <a href={`https://www.google.com/maps?q=${c.latitude},${c.longitude}`} target="_blank" rel="noreferrer" className="gps-view-link complaint-map-link">
                  📍 Voir la position sur la carte
                </a>
              )}
              {c.description && <div className="complaint-desc">{c.description}</div>}
              <div className="complaint-date">{c.createdAt ? new Date(c.createdAt).toLocaleString("fr-FR") : ""}</div>
            </div>
          ))}
        </div>
      )}

      {tab === "users" && (
        <div className="view active">
          <div className="toolbar">
            <div style={{ fontSize: 12.5, color: "var(--text-dim)" }}>
              Comptes Admin et Technicien — les clients gardent leur code d'accès individuel (fiche client).
            </div>
            <button className="btn-add" onClick={openAddUser}>
              <svg viewBox="0 0 24 24" fill="none" stroke="#08201C" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
              Nouvel utilisateur
            </button>
          </div>

          <div className="table-shell client-list-shell">
            {users.length === 0 && <div className="empty">Aucun utilisateur.</div>}
            {users.map((u) => (
              <div className="client-row" key={u.id}>
                <div className="client-row-top">
                  <div className="client-row-left">
                    <span className="client-row-name">{u.nom}</span>
                    <span className={`badge ${u.role === "admin" ? "OK" : "ATTENTION"}`}>{u.role === "admin" ? "Admin" : "Technicien"}</span>
                  </div>
                  <div className="row-actions">
                    <button className="icon-btn" title="Modifier" onClick={() => openEditUser(u)}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                    </button>
                    <button className="icon-btn del" title="Supprimer" onClick={() => deleteUser(u)}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></svg>
                    </button>
                  </div>
                </div>
                <div className="client-row-meta">
                  <span>Code PIN : </span>
                  <span style={{ fontWeight: 700, letterSpacing: 2, color: "var(--cyan)" }}>{u.pin}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {userModal && (
        <div className="overlay show" onClick={(e) => e.target.classList.contains("overlay") && closeUserModal()}>
          <div className="modal">
            <h2>{userModal.editingId ? "Modifier l'utilisateur" : "Nouvel utilisateur"}</h2>
            <div className="field">
              <label>Nom</label>
              <input placeholder="Ex: Jean" value={userModal.nom} onChange={(e) => setUserModal({ ...userModal, nom: e.target.value })} />
            </div>
            <div className="field">
              <label>Rôle</label>
              <select value={userModal.role} onChange={(e) => setUserModal({ ...userModal, role: e.target.value })}>
                <option value="admin">Admin</option>
                <option value="technicien">Technicien</option>
              </select>
            </div>
            <div className="field">
              <label>Code PIN</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  style={{ fontFamily: "var(--mono)", letterSpacing: 2, fontWeight: 700 }}
                  value={userModal.pin}
                  onChange={(e) => setUserModal({ ...userModal, pin: e.target.value })}
                />
                <button type="button" className="btn-cancel" style={{ flex: "0 0 auto", padding: "0 14px" }} onClick={() => setUserModal({ ...userModal, pin: generateUserPin() })}>
                  ↻
                </button>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn-cancel" onClick={closeUserModal}>Annuler</button>
              <button className="btn-save" onClick={saveUserModal}>Enregistrer</button>
            </div>
          </div>
        </div>
      )}

      <footer>Les données sont enregistrées automatiquement sur cet appareil · calcul des jours restants en temps réel</footer>

      {/* ---- Client modal ---- */}
      {clientModal && (
        <div className="overlay show" onClick={(e) => e.target.classList.contains("overlay") && closeClientModal()}>
          <div className="modal">
            <h2>{clientModal.editingId ? "Modifier le client" : "Nouveau client"}</h2>
            <div className="field">
              <label>Nom du client</label>
              <input
                placeholder="Ex: KOFFI"
                value={clientModal.nom}
                onChange={(e) => {
                  const nom = e.target.value;
                  setClientModal((m) => ({ ...m, nom, accessCode: computeClientCode(nom, m.telephone) }));
                }}
              />
            </div>
            <div className="field">
              <label>Offre / Prix (ou référence)</label>
              <input placeholder="Ex: 30 Mbps/10 000F" value={clientModal.offre} onChange={(e) => setClientModal({ ...clientModal, offre: e.target.value })} />
            </div>
            <div className="field">
              <label>Téléphone WhatsApp</label>
              <input
                type="tel"
                placeholder="Ex: 90 12 34 56 ou +228 90 12 34 56"
                value={clientModal.telephone}
                onChange={(e) => {
                  const telephone = e.target.value;
                  setClientModal((m) => ({ ...m, telephone, accessCode: computeClientCode(m.nom, telephone) }));
                }}
              />
              <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 6 }}>
                Le code d'accès du client est calculé à partir des 4 derniers chiffres de ce numéro.
              </div>
            </div>
            <div className="field">
              <label>Date d'expiration</label>
              <DatePickerInput value={clientModal.dateExp} onChange={(e) => setClientModal({ ...clientModal, dateExp: e.target.value })} />
            </div>
            <div className="field">
              <label>Code d'accès client (espace personnel)</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  style={{ fontFamily: "var(--mono)", letterSpacing: 2, fontWeight: 700 }}
                  value={clientModal.accessCode}
                  onChange={(e) => setClientModal({ ...clientModal, accessCode: e.target.value.toUpperCase() })}
                />
                <button
                  type="button"
                  className="btn-cancel"
                  style={{ flex: "0 0 auto", padding: "0 14px" }}
                  onClick={() => setClientModal((m) => ({ ...m, accessCode: computeClientCode(m.nom, m.telephone) }))}
                >
                  ↻
                </button>
              </div>
              <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 6 }}>
                Calculé automatiquement (4 derniers chiffres du téléphone + 2 premières lettres du nom). Transmets-le au client par WhatsApp — modifiable si besoin.
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn-cancel" onClick={closeClientModal}>Annuler</button>
              <button className="btn-save" onClick={saveClientModal}>Enregistrer</button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Payment modal ---- */}
      {paymentModal && (
        <div className="overlay show" onClick={(e) => e.target.classList.contains("overlay") && closePaymentModal()}>
          <div className="modal">
            <h2>{paymentModal.editingId ? "Modifier le paiement" : pendingRequestId ? "Valider la demande de paiement" : "Enregistrer un paiement"}</h2>
            <div className="field">
              <label>Client</label>
              <input
                list="clientNamesList"
                placeholder="Nom du client"
                value={paymentModal.clientNom}
                onChange={(e) => onPaymentClientNameChange(e.target.value)}
              />
              <datalist id="clientNamesList">
                {clients.map((c) => <option key={c.id} value={c.nom} />)}
              </datalist>
            </div>
            <div className="field">
              <label>Montant (FCFA)</label>
              <input type="number" min="0" step="1" placeholder="Ex: 10000" value={paymentModal.montant} onChange={(e) => setPaymentModal({ ...paymentModal, montant: e.target.value })} />
            </div>
            <div className="field">
              <label>Mode de paiement</label>
              <select value={paymentModal.mode} onChange={(e) => setPaymentModal({ ...paymentModal, mode: e.target.value })}>
                <option value="Cash">Cash</option>
                <option value="Mix by Yas">Mix by Yas</option>
                <option value="Flooz">Flooz</option>
                <option value="Virement">Virement</option>
                <option value="Autre">Autre</option>
              </select>
            </div>
            <div className="field">
              <label>Date du paiement</label>
              <DatePickerInput value={paymentModal.date} onChange={(e) => setPaymentModal({ ...paymentModal, date: e.target.value })} />
            </div>
            <div className="field">
              <label>Nouvelle date d'expiration WiFi</label>
              <DatePickerInput value={paymentModal.newExpiration} onChange={(e) => setPaymentModal({ ...paymentModal, newExpiration: e.target.value })} />
            </div>
            <div className="field">
              <label>Note (optionnel)</label>
              <textarea placeholder="Ex: renouvellement 30 jours" value={paymentModal.note} onChange={(e) => setPaymentModal({ ...paymentModal, note: e.target.value })} />
            </div>
            <div className="modal-actions">
              <button className="btn-cancel" onClick={closePaymentModal}>Annuler</button>
              <button className="btn-save" onClick={savePaymentModal}>Enregistrer</button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Row-actions sheet (WhatsApp / Modifier / Supprimer) ---- */}
      {rowActionsClient && (
        <div className="overlay show" onClick={(e) => e.target.classList.contains("overlay") && setRowActionsClient(null)}>
          <div className="modal row-actions-modal">
            <h2>{rowActionsClient.nom}</h2>
            <div className="row-actions-sub">{rowActionsClient.offre || "Sans offre"} · Expire le {fmtDate(rowActionsClient.dateExp)}</div>
            <div className="row-actions-history">
              {(() => {
                const nom = rowActionsClient.nom.trim().toLowerCase();
                const history = payments
                  .filter((p) => (p.clientNom || "").trim().toLowerCase() === nom)
                  .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
                return (
                  <>
                    <div className="rah-title">Historique des paiements{history.length ? ` (${history.length})` : ""}</div>
                    {history.length === 0 && <div className="rah-empty">Aucun paiement enregistré pour ce client.</div>}
                    {history.map((p) => (
                      <div className="rah-item" key={p.id}>
                        <span className="rah-date">{fmtDate(p.date)}</span>
                        <span>{p.mode || "—"}</span>
                        <span className="rah-amount">{fmtFCFA(p.montant)}</span>
                      </div>
                    ))}
                  </>
                );
              })()}
            </div>
            <div className="row-actions-list">
              <button className="row-action-btn wa" onClick={() => { const c = rowActionsClient; setRowActionsClient(null); sendWhatsApp(c); }}>
                <WhatsAppIcon />
                Envoyer sur WhatsApp
              </button>
              <button className="row-action-btn" onClick={() => { const c = rowActionsClient; setRowActionsClient(null); openEditClient(c); }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                Modifier
              </button>
              <button className="row-action-btn del" onClick={() => { const c = rowActionsClient; setRowActionsClient(null); deleteClient(c); }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></svg>
                Supprimer
              </button>
            </div>
            <button className="btn-cancel" style={{ width: "100%", marginTop: 14 }} onClick={() => setRowActionsClient(null)}>Fermer</button>
          </div>
        </div>
      )}

      {/* ---- Relance groupée (bulk WhatsApp) ---- */}
      {bulkOpen && (
        <div className="overlay show" onClick={(e) => e.target.classList.contains("overlay") && closeBulk()}>
          <div className="modal">
            <h2>Relance groupée</h2>
            <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginBottom: 14 }}>
              {bulkQueue.length} client(s) à relancer{bulkSkippedNoPhone > 0 ? ` · ${bulkSkippedNoPhone} sans numéro (ignorés)` : ""}
            </div>
            {bulkIndex >= bulkQueue.length ? (
              <div style={{ textAlign: "center", padding: "24px 0", color: "var(--text-dim)", fontSize: 13 }}>
                Tous les clients ont été traités 🎉
              </div>
            ) : (
              <>
                <div style={{ padding: 14, border: "1px solid var(--line)", borderRadius: 10 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{bulkQueue[bulkIndex].nom}</div>
                  <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 4 }}>
                    <span className={`badge ${bulkQueue[bulkIndex].statut}`}>{bulkQueue[bulkIndex].statut}</span> · Expire le {fmtDate(bulkQueue[bulkIndex].dateExp)}
                  </div>
                </div>
                <div style={{ textAlign: "center", fontSize: 11.5, color: "var(--text-faint)", marginTop: 10 }}>
                  Client {bulkIndex + 1} / {bulkQueue.length}
                </div>
              </>
            )}
            <div className="modal-actions">
              <button className="btn-cancel" onClick={bulkSkipCurrent} style={{ display: bulkIndex >= bulkQueue.length ? "none" : undefined }}>Passer</button>
              <button className="btn-save" onClick={bulkSendCurrent} style={{ display: bulkIndex >= bulkQueue.length ? "none" : undefined }}>Ouvrir WhatsApp</button>
            </div>
            <button className="btn-cancel" style={{ width: "100%", marginTop: 10 }} onClick={closeBulk}>Fermer</button>
          </div>
        </div>
      )}

      {/* ---- Bilan mensuel (printable report) ---- */}
      {bilanOpen && (
        <div className="overlay show" onClick={(e) => e.target.classList.contains("overlay") && closeBilan()}>
          <div className="modal bilan-modal">
            <div className="bilan-toolbar no-print">
              <h2 style={{ margin: 0 }}>Bilan comptable mensuel</h2>
              <div className="bilan-toolbar-actions">
                <input type="month" value={bilanMonth} onChange={(e) => setBilanMonth(e.target.value)} />
                <button className="btn-cancel" onClick={closeBilan}>Fermer</button>
                <button className="btn-save" onClick={printBilan}>Imprimer / Enregistrer en PDF</button>
              </div>
            </div>
            <div className="bilan-print">
              <h1>Bilan comptable mensuel — APESPOT WI-FI</h1>
              <div className="bilan-sub">
                Période : {bilanMonthLabel} · Généré le {new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" })}
              </div>

              <div className="bilan-cards">
                <div className="bilan-card"><div className="bn">{fmtFCFA(bilanData.total)}</div><div className="bl">Total encaissé</div></div>
                <div className="bilan-card"><div className="bn">{bilanData.count}</div><div className="bl">Paiements</div></div>
                <div className="bilan-card"><div className="bn">{fmtFCFA(bilanData.avg)}</div><div className="bl">Montant moyen</div></div>
                <div className="bilan-card"><div className="bn">{clients.length}</div><div className="bl">Clients au total</div></div>
              </div>

              <h3>Répartition par mode de paiement</h3>
              <table>
                <thead><tr><th>Mode</th><th style={{ textAlign: "right" }}>Nb</th><th style={{ textAlign: "right" }}>Montant</th><th style={{ textAlign: "right" }}>Part</th></tr></thead>
                <tbody>
                  {bilanData.byMode.length === 0 && (
                    <tr><td colSpan={4} className="bilan-empty">Aucun paiement enregistré pour ce mois.</td></tr>
                  )}
                  {bilanData.byMode.map((r) => (
                    <tr key={r.mode}>
                      <td>{r.mode}</td>
                      <td style={{ textAlign: "right" }}>{r.count}</td>
                      <td style={{ textAlign: "right" }}>{fmtFCFA(r.sum)}</td>
                      <td style={{ textAlign: "right" }}>{bilanData.total ? Math.round((r.sum / bilanData.total) * 100) : 0}%</td>
                    </tr>
                  ))}
                  {bilanData.byMode.length > 0 && (
                    <tr className="bilan-total-row">
                      <td>Total</td>
                      <td style={{ textAlign: "right" }}>{bilanData.count}</td>
                      <td style={{ textAlign: "right" }}>{fmtFCFA(bilanData.total)}</td>
                      <td style={{ textAlign: "right" }}>100%</td>
                    </tr>
                  )}
                </tbody>
              </table>

              <h3>Détail des paiements du mois</h3>
              <table>
                <thead><tr><th>Date</th><th>Client</th><th>Mode</th><th style={{ textAlign: "right" }}>Montant</th><th>Note</th></tr></thead>
                <tbody>
                  {bilanData.sorted.length === 0 && (
                    <tr><td colSpan={5} className="bilan-empty">Aucun paiement enregistré pour ce mois.</td></tr>
                  )}
                  {bilanData.sorted.map((p) => (
                    <tr key={p.id}>
                      <td>{fmtDate(p.date)}</td>
                      <td>{p.clientNom || "—"}</td>
                      <td>{p.mode || "—"}</td>
                      <td style={{ textAlign: "right" }}>{fmtFCFA(p.montant)}</td>
                      <td>{p.note || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <h3>État du parc clients WiFi (à la date de génération)</h3>
              <table>
                <thead><tr><th>Statut</th><th style={{ textAlign: "right" }}>Nombre</th></tr></thead>
                <tbody>
                  <tr><td>Expirés</td><td style={{ textAlign: "right" }}>{bilanData.nbExpire}</td></tr>
                  <tr><td>À surveiller</td><td style={{ textAlign: "right" }}>{bilanData.nbAttention}</td></tr>
                  <tr><td>À jour</td><td style={{ textAlign: "right" }}>{bilanData.nbOk}</td></tr>
                  <tr className="bilan-total-row"><td>Total clients</td><td style={{ textAlign: "right" }}>{clients.length}</td></tr>
                </tbody>
              </table>

              <div className="bilan-footer">APESPOT WI-FI · Gestion des clients · Document généré automatiquement</div>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}

// -------------------- Styles (same design language as the HTML version) --------------------
const CSS = `
.wifi-app{
  --bg:#0E1520; --bg-panel:#161F2C; --bg-card:#1B2635; --bg-hover:#212D3D; --line:#2A3747;
  --text:#E7EDF4; --text-dim:#8FA0B3; --text-faint:#5C6C7E;
  --cyan:#3ED8C3; --cyan-dim:#1E5850; --red:#F0555F; --red-dim:#3C1E24;
  --amber:#F5AC3C; --amber-dim:#402C12; --green:#3FD684; --green-dim:#123425;
  --mono:ui-monospace,SFMono-Regular,'JetBrains Mono',Menlo,Consolas,monospace;
  --sans:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,sans-serif;
  background:radial-gradient(circle at 15% 0%, #14202e 0%, transparent 45%),
             radial-gradient(circle at 90% 10%, #142722 0%, transparent 40%), var(--bg);
  color:var(--text); font-family:var(--sans); min-height:100vh; padding:28px 20px 60px; border-radius:8px;
}
.wifi-app *{box-sizing:border-box;}
.wifi-app{-webkit-text-size-adjust:100%;text-size-adjust:100%;}
.wifi-app header{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;flex-wrap:wrap;margin-bottom:26px;}
.wifi-app .brand{display:flex;align-items:center;gap:14px;}
.wifi-app .brand-mark{width:44px;height:44px;border-radius:12px;background:linear-gradient(145deg,var(--cyan),#1E9E8C);display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 1px rgba(62,216,195,.25), 0 8px 20px -6px rgba(62,216,195,.5);}
.wifi-app .brand-mark svg{width:24px;height:24px;}
.wifi-app .brand-mark.brand-mark-logo{width:auto;height:52px;padding:4px 8px;background:#fff;box-shadow:0 0 0 1px rgba(255,255,255,.08), 0 8px 20px -6px rgba(0,0,0,.4);}
.wifi-app .brand-mark.brand-mark-logo img{height:100%;width:auto;display:block;}
.wifi-app .brand h1{font-size:20px;margin:0;letter-spacing:.2px;font-weight:700;color:#FFE9A8;}
.wifi-app .brand .sub{font-size:12.5px;color:var(--text-dim);margin-top:2px;letter-spacing:.3px;}
.wifi-app .today-box{display:flex;align-items:baseline;gap:10px;font-family:var(--mono);}
.wifi-app .today-box .label{font-size:12px;color:#FFD400;letter-spacing:1px;text-transform:uppercase;font-weight:700;order:-1;}
.wifi-app .today-box .val{font-size:16px;color:var(--cyan);font-weight:600;}
.wifi-app .tabs{display:flex;gap:8px;margin-bottom:22px;border-bottom:1px solid var(--line);}
.wifi-app .tab{padding:10px 4px;margin-bottom:-1px;background:none;border:none;color:var(--text-faint);font-size:13.5px;font-weight:600;cursor:pointer;border-bottom:2px solid transparent;font-family:var(--sans);}
.wifi-app .tab.active{color:var(--cyan);border-bottom-color:var(--cyan);}
.wifi-app .tab-badge{display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;padding:0 4px;margin-left:5px;border-radius:8px;background:var(--red);color:#fff;font-size:10px;font-weight:700;vertical-align:middle;}
.wifi-app .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:22px;}
.wifi-app .stat{background:var(--bg-card);border:1px solid var(--line);border-radius:14px;padding:16px 18px;position:relative;overflow:hidden;}
.wifi-app .stat::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;}
.wifi-app .stat.expire::before{background:var(--red);}
.wifi-app .stat.attention::before{background:var(--amber);}
.wifi-app .stat.ok::before{background:var(--green);}
.wifi-app .stat.total::before{background:var(--cyan);}
.wifi-app .stat .n{font-family:var(--mono);font-size:24px;font-weight:700;line-height:1;}
.wifi-app .stat .l{font-size:12px;color:var(--text-dim);margin-top:6px;letter-spacing:.3px;}
.wifi-app .toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:16px;}
.wifi-app .search{flex:1;min-width:180px;position:relative;}
.wifi-app .search input{width:100%;padding:10px 14px 10px 36px;border-radius:10px;background:var(--bg-card);border:1px solid var(--line);color:var(--text);font-size:13.5px;font-family:var(--sans);outline:none;}
.wifi-app .search input:focus{border-color:var(--cyan);}
.wifi-app .search svg{position:absolute;left:11px;top:50%;transform:translateY(-50%);width:15px;height:15px;color:var(--text-faint);}
.wifi-app .chips{display:flex;gap:6px;flex-wrap:wrap;}
.wifi-app .chip{padding:8px 13px;border-radius:9px;border:1px solid var(--line);background:var(--bg-card);color:var(--text-dim);font-size:12.5px;cursor:pointer;font-family:var(--sans);white-space:nowrap;transition:.15s;}
.wifi-app .chip:hover{border-color:var(--text-faint);color:var(--text);}
.wifi-app .chip.active{background:var(--cyan-dim);border-color:var(--cyan);color:var(--cyan);}
.wifi-app .btn-add{padding:8px 13px;border-radius:9px;border:none;background:var(--cyan);color:#08201C;font-weight:700;font-size:12.5px;cursor:pointer;display:flex;align-items:center;gap:6px;white-space:nowrap;flex-shrink:0;}
.wifi-app .btn-add:hover{filter:brightness(1.08);}
.wifi-app .btn-add svg{width:14px;height:14px;flex-shrink:0;}
.wifi-app .chart-card{background:var(--bg-card);border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin-bottom:16px;}
.wifi-app .chart-card .ctitle{font-size:12px;color:var(--text-dim);letter-spacing:.3px;margin-bottom:16px;}
.wifi-app .chart-bars{display:flex;align-items:flex-end;gap:14px;height:120px;}
.wifi-app .chart-col{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;gap:8px;}
.wifi-app .chart-col .bar{width:100%;max-width:38px;border-radius:5px 5px 2px 2px;background:linear-gradient(180deg,var(--cyan),var(--cyan-dim));min-height:3px;transition:height .3s;}
.wifi-app .chart-col .clabel{font-size:10.5px;color:var(--text-faint);font-family:var(--mono);text-transform:uppercase;}
.wifi-app .chart-col .cval{font-size:10px;color:var(--text-dim);font-family:var(--mono);}
.wifi-app .loyalty-row{display:flex;gap:28px;flex-wrap:wrap;}
.wifi-app .loyalty-item{min-width:120px;}
.wifi-app .loyalty-val{font-family:var(--mono);font-size:24px;font-weight:700;color:var(--cyan);}
.wifi-app .loyalty-val.loyalty-green{color:var(--green);}
.wifi-app .loyalty-label{font-size:11px;color:var(--text-dim);margin-top:4px;}
.wifi-app .row-actions-history{margin-bottom:16px;}
.wifi-app .rah-title{font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-faint);margin-bottom:8px;}
.wifi-app .rah-item{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--line);font-size:12px;}
.wifi-app .rah-item:last-child{border-bottom:none;}
.wifi-app .rah-date{color:var(--text-dim);font-family:var(--mono);font-size:11px;flex-shrink:0;}
.wifi-app .rah-amount{color:var(--green);font-weight:700;font-family:var(--mono);flex-shrink:0;}
.wifi-app .rah-empty{font-size:12px;color:var(--text-faint);}
.wifi-app .table-shell{background:var(--bg-panel);border:1px solid var(--line);border-radius:16px;overflow-x:auto;-webkit-overflow-scrolling:touch;}
.wifi-app table{width:100%;min-width:720px;border-collapse:collapse;}
.wifi-app thead th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.8px;color:var(--text-faint);padding:13px 16px;font-weight:600;border-bottom:1px solid var(--line);cursor:pointer;user-select:none;}
.wifi-app thead th:hover{color:var(--text-dim);}
.wifi-app tbody td{padding:13px 16px;font-size:13.5px;border-bottom:1px solid var(--line);vertical-align:middle;}
.wifi-app tbody tr:last-child td{border-bottom:none;}
.wifi-app tbody tr:hover{background:var(--bg-hover);}
.wifi-app tbody tr.row-clickable{cursor:pointer;}
.wifi-app .client-name{font-weight:600;color:var(--text);}
.wifi-app .offre,.wifi-app .exp-date{font-family:var(--mono);font-size:12.5px;color:var(--text-dim);}
.wifi-app .jours{font-family:var(--mono);font-weight:700;}
.wifi-app .jours.neg{color:var(--red);}
.wifi-app .jours.mid{color:var(--amber);}
.wifi-app .jours.pos{color:var(--green);}
.wifi-app .jours.na{color:var(--text-faint);font-weight:400;}
.wifi-app .signal{display:inline-flex;align-items:flex-end;gap:2px;height:16px;}
.wifi-app .signal i{display:block;width:3px;border-radius:1px;background:var(--line);}
.wifi-app .signal i:nth-child(1){height:5px;}
.wifi-app .signal i:nth-child(2){height:8px;}
.wifi-app .signal i:nth-child(3){height:11px;}
.wifi-app .signal i:nth-child(4){height:14px;}
.wifi-app .signal.red i:nth-child(1){background:var(--red);}
.wifi-app .signal.amber i:nth-child(1),.wifi-app .signal.amber i:nth-child(2){background:var(--amber);}
.wifi-app .signal.green i{background:var(--green);}
.wifi-app .signal.na i{background:var(--line);}
.wifi-app .badge{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:7px;font-size:11.5px;font-weight:700;letter-spacing:.3px;}
.wifi-app .badge.EXPIRE{background:var(--red-dim);color:var(--red);}
.wifi-app .badge.ATTENTION{background:var(--amber-dim);color:var(--amber);}
.wifi-app .badge.OK{background:var(--green-dim);color:var(--green);}
.wifi-app .badge.NA{background:#222E3D;color:var(--text-faint);}
.wifi-app .action-text{font-size:12.5px;color:var(--text-dim);}
.wifi-app .action-text.urgent{color:var(--red);font-weight:600;}
.wifi-app .action-text.warn{color:var(--amber);font-weight:600;}
.wifi-app .row-actions{display:flex;gap:6px;justify-content:flex-end;}
.wifi-app .icon-btn{width:28px;height:28px;border-radius:7px;border:1px solid var(--line);background:transparent;color:var(--text-faint);cursor:pointer;display:flex;align-items:center;justify-content:center;}
.wifi-app .icon-btn:hover{border-color:var(--cyan);color:var(--cyan);}
.wifi-app .icon-btn.del:hover{border-color:var(--red);color:var(--red);}
.wifi-app .icon-btn.wa:hover{border-color:#25D366;color:#25D366;}
.wifi-app .row-actions-modal{max-width:340px;}
.wifi-app .row-actions-sub{font-size:12.5px;color:var(--text-dim);margin-top:-10px;margin-bottom:16px;}
.wifi-app .row-actions-list{display:flex;flex-direction:column;gap:8px;}
.wifi-app .row-action-btn{display:flex;align-items:center;gap:10px;width:100%;padding:12px 14px;border-radius:10px;border:1px solid var(--line);background:var(--bg-card);color:var(--text);font-size:13.5px;font-weight:600;cursor:pointer;font-family:var(--sans);text-align:left;}
.wifi-app .row-action-btn svg{width:16px;height:16px;flex-shrink:0;}
.wifi-app .row-action-btn:hover{border-color:var(--text-faint);}
.wifi-app .row-action-btn.wa{color:#25D366;}
.wifi-app .row-action-btn.wa:hover{border-color:#25D366;background:rgba(37,211,102,.08);}
.wifi-app .row-action-btn.del{color:var(--red);}
.wifi-app .row-action-btn.del:hover{border-color:var(--red);background:var(--red-dim);}
.wifi-app .icon-btn svg{width:14px;height:14px;}
.wifi-app .empty{padding:50px 20px;text-align:center;color:var(--text-faint);font-size:13.5px;}
.wifi-app .client-list-shell{overflow-x:visible;}
.wifi-app .client-list-header{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid var(--line);font-size:10.5px;text-transform:uppercase;letter-spacing:.6px;color:var(--text-faint);}
.wifi-app .client-list-header span{cursor:pointer;user-select:none;}
.wifi-app .client-list-header span:hover{color:var(--text-dim);}
.wifi-app .client-row{padding:10px 14px;border-bottom:1px solid var(--line);cursor:pointer;display:flex;flex-direction:column;gap:4px;}
.wifi-app .client-row:last-child{border-bottom:none;}
.wifi-app .client-row:hover{background:var(--bg-hover);}
.wifi-app .client-row-top{display:flex;align-items:center;justify-content:space-between;gap:8px;}
.wifi-app .client-row-left{display:flex;align-items:center;gap:8px;min-width:0;}
.wifi-app .client-row-name{font-weight:600;font-size:13.5px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.wifi-app .client-row-meta{display:flex;align-items:center;gap:6px;font-size:11.5px;font-family:var(--mono);color:var(--text-dim);flex-wrap:wrap;padding-left:22px;}
.wifi-app .client-row-meta .dot{color:var(--text-faint);}
.wifi-app .client-row-meta .jours{font-size:11.5px;}
.wifi-app .client-row-meta .action-text{font-size:11.5px;font-family:var(--sans);}
.wifi-app .client-list-scroll{max-height:344px;overflow-y:auto;scrollbar-width:thin;scrollbar-color:var(--line) transparent;}
.wifi-app .client-list-scroll::-webkit-scrollbar{width:8px;}
.wifi-app .client-list-scroll::-webkit-scrollbar-track{background:transparent;}
.wifi-app .client-list-scroll::-webkit-scrollbar-thumb{background:var(--line);border-radius:8px;}
.wifi-app .client-list-scroll::-webkit-scrollbar-thumb:hover{background:var(--text-faint);}
.wifi-app .overlay{position:fixed;inset:0;background:rgba(6,10,15,.7);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;z-index:50;padding:20px;}
.wifi-app .modal{background:var(--bg-panel);border:1px solid var(--line);border-radius:16px;width:100%;max-width:420px;padding:24px;max-height:90vh;overflow-y:auto;}
.wifi-app .modal h2{margin:0 0 18px;font-size:16px;}
.wifi-app .field{margin-bottom:14px;}
.wifi-app .field label{font-size:12px;color:var(--text-dim);display:block;margin-bottom:6px;letter-spacing:.2px;}
.wifi-app .field input,.wifi-app .field select,.wifi-app .field textarea{width:100%;padding:10px 12px;border-radius:9px;border:1px solid var(--line);background:var(--bg-card);color:var(--text);font-size:13.5px;font-family:var(--sans);outline:none;}
.wifi-app .field textarea{resize:vertical;min-height:60px;}
.wifi-app .field input:focus,.wifi-app .field select:focus,.wifi-app .field textarea:focus{border-color:var(--cyan);}
.wifi-app .modal-actions{display:flex;gap:10px;margin-top:20px;}
.wifi-app .modal-actions button{flex:1;padding:11px;border-radius:9px;border:1px solid var(--line);font-size:13px;font-weight:600;cursor:pointer;font-family:var(--sans);}
.wifi-app .btn-cancel{background:transparent;color:var(--text-dim);}
.wifi-app .btn-save{background:var(--cyan);color:#08201C;border-color:var(--cyan);}
.wifi-app .toast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:var(--bg-card);border:1px solid var(--line);color:var(--text);padding:11px 18px;border-radius:10px;font-size:13px;z-index:60;}
.wifi-app footer{text-align:center;color:var(--text-faint);font-size:11.5px;margin-top:28px;letter-spacing:.2px;}
.wifi-app .btn-add.btn-report{background:transparent;border:1px solid var(--cyan);color:var(--cyan);}
.wifi-app .btn-add.btn-report:hover{background:var(--cyan-dim);}
.wifi-app .bilan-modal{max-width:820px;padding:0;overflow:hidden;}
.wifi-app .bilan-toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding:18px 24px;border-bottom:1px solid var(--line);}
.wifi-app .bilan-toolbar-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap;}
.wifi-app .bilan-toolbar-actions input[type="month"]{padding:9px 12px;border-radius:9px;border:1px solid var(--line);background:var(--bg-card);color:var(--text);font-size:13px;font-family:var(--sans);}
.wifi-app .bilan-toolbar-actions button{padding:9px 14px;border-radius:9px;font-size:12.5px;font-weight:600;border:1px solid var(--line);cursor:pointer;font-family:var(--sans);}
.wifi-app .bilan-toolbar-actions .btn-save{background:var(--cyan);color:#08201C;border-color:var(--cyan);}
.wifi-app .bilan-toolbar-actions .btn-cancel{background:transparent;color:var(--text-dim);}
.wifi-app .bilan-print{background:#fff;color:#1A1A1A;padding:32px 36px;max-height:70vh;overflow-y:auto;font-family:var(--sans);}
.wifi-app .bilan-print h1{font-size:19px;margin:0 0 2px;color:#0E1520;}
.wifi-app .bilan-print .bilan-sub{font-size:12.5px;color:#5C6C7E;margin-bottom:22px;}
.wifi-app .bilan-print h3{font-size:12.5px;text-transform:uppercase;letter-spacing:.6px;color:#5C6C7E;margin:22px 0 10px;border-bottom:1px solid #E2E6EB;padding-bottom:6px;}
.wifi-app .bilan-print .bilan-cards{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:6px;}
.wifi-app .bilan-print .bilan-card{border:1px solid #E2E6EB;border-radius:10px;padding:12px 14px;}
.wifi-app .bilan-print .bilan-card .bn{font-family:var(--mono);font-size:18px;font-weight:700;color:#0E1520;}
.wifi-app .bilan-print .bilan-card .bl{font-size:10.5px;color:#8FA0B3;margin-top:4px;}
.wifi-app .bilan-print table{width:100%;border-collapse:collapse;font-size:12px;}
.wifi-app .bilan-print thead th{text-align:left;padding:7px 8px;background:#F4F6F8;color:#5C6C7E;font-size:10px;text-transform:uppercase;letter-spacing:.4px;border-bottom:1px solid #E2E6EB;}
.wifi-app .bilan-print tbody td{padding:7px 8px;border-bottom:1px solid #EFF2F5;}
.wifi-app .bilan-print tbody tr:last-child td{border-bottom:none;}
.wifi-app .bilan-print .bilan-total-row td{font-weight:700;border-top:2px solid #1A1A1A;background:#F4F6F8;}
.wifi-app .bilan-print .bilan-empty{color:#8FA0B3;font-size:12.5px;padding:10px 0;}
.wifi-app .bilan-print .bilan-footer{margin-top:26px;font-size:10.5px;color:#8FA0B3;text-align:center;}
@media print{
  body *{visibility:hidden;}
  .wifi-app .bilan-print, .wifi-app .bilan-print *{visibility:visible;}
  .wifi-app .bilan-print{position:absolute;left:0;top:0;width:100%;max-height:none;overflow:visible;padding:0;}
  .wifi-app .no-print{display:none !important;}
  @page{margin:16mm;}
}
@media(max-width:640px){
  .wifi-app .stats{grid-template-columns:repeat(2,1fr);}
}

/* LOGIN SCREEN */
.wifi-app.login-screen{display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px;}
.wifi-app .login-card{width:100%;max-width:360px;background:var(--bg-panel);border:1px solid var(--line);border-radius:18px;padding:32px 26px;}
.wifi-app .login-roles{display:flex;flex-direction:column;gap:10px;}
.wifi-app .login-role-btn{width:100%;padding:16px;border-radius:12px;border:1px solid var(--line);background:var(--bg-card);cursor:pointer;text-align:left;font-family:var(--sans);}
.wifi-app .login-role-btn:hover{border-color:var(--cyan);background:var(--cyan-dim);}
.wifi-app .login-role-btn .lr-title{font-size:14.5px;font-weight:700;color:var(--text);}
.wifi-app .login-role-btn .lr-sub{font-size:11.5px;color:var(--text-dim);margin-top:2px;}
.wifi-app .login-form label{font-size:12px;color:var(--text-dim);display:block;margin-bottom:8px;}
.wifi-app .login-form input{width:100%;padding:12px;border-radius:10px;border:1px solid var(--line);background:var(--bg-card);color:var(--text);}
.wifi-app .login-error{color:var(--red);font-size:12px;margin-top:10px;text-align:center;}

/* LOGOUT LINK */
.wifi-app .logout-link{background:none;border:none;color:var(--text-faint);font-size:11px;cursor:pointer;margin-top:6px;text-decoration:underline;font-family:var(--sans);}
.wifi-app .logout-link:hover{color:var(--text-dim);}
.wifi-app .logout-link.logout-inline{margin-top:0;font-size:10.5px;vertical-align:middle;}

/* COMPLAINT CARDS (technicien inbox) */
.wifi-app .complaint-card{background:var(--bg-card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-bottom:10px;}
.wifi-app .complaint-top{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:6px;}
.wifi-app .complaint-client{font-weight:700;font-size:14px;}
.wifi-app .complaint-reason{font-size:13px;color:var(--cyan);font-weight:600;}
.wifi-app .complaint-meta{font-size:11.5px;color:var(--text-dim);margin-top:4px;font-family:var(--mono);}
.wifi-app .complaint-desc{font-size:12.5px;color:var(--text-dim);margin-top:8px;line-height:1.4;}
.wifi-app .complaint-date{font-size:10.5px;color:var(--text-faint);margin-top:8px;}
.wifi-app .gps-captured{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:11px 14px;border-radius:10px;border:1px solid var(--green);background:var(--green-dim);flex-wrap:wrap;}
.wifi-app .gps-captured-info{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--green);font-weight:600;}
.wifi-app .gps-dot{font-size:9px;}
.wifi-app .gps-view-link{color:var(--cyan);font-size:11.5px;text-decoration:underline;font-weight:600;margin-left:4px;}
.wifi-app .complaint-map-link{display:inline-block;margin-top:8px;font-size:12px;}
.wifi-app .request-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--line);flex-wrap:wrap;}
.wifi-app .request-row:first-of-type{border-top:none;}
.wifi-app .request-client{font-weight:700;font-size:13.5px;}
.wifi-app .request-meta{font-size:11.5px;color:var(--text-dim);margin-top:2px;font-family:var(--mono);}
.wifi-app .request-actions{display:flex;gap:8px;}
.wifi-app .button-row{display:flex;gap:10px;margin-bottom:16px;}
.wifi-app .call-reminder{background:var(--green-dim);border:1px solid var(--green);color:var(--green);padding:11px 14px;border-radius:10px;font-size:12.5px;margin-bottom:14px;line-height:1.4;}
.wifi-app .status-select{padding:5px 10px;border-radius:7px;border:1px solid var(--line);background:var(--bg-panel);color:var(--text);font-size:11.5px;font-weight:700;}
.wifi-app .status-select.status-nouveau{color:var(--red);}
.wifi-app .status-select.status-en_cours{color:var(--amber);}
.wifi-app .status-select.status-resolu{color:var(--green);}

/* MESSAGE THREADS */
.wifi-app .thread-row{padding:12px 14px;border-bottom:1px solid var(--line);cursor:pointer;}
.wifi-app .thread-row:hover{background:var(--bg-hover);}
.wifi-app .thread-name{font-weight:700;font-size:13.5px;}
.wifi-app .thread-preview{font-size:12px;color:var(--text-dim);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.wifi-app .thread-view{display:flex;flex-direction:column;height:60vh;}
.wifi-app .thread-messages{flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding:4px 2px;}
.wifi-app .msg-bubble{max-width:80%;padding:10px 13px;border-radius:12px;font-size:13px;line-height:1.4;}
.wifi-app .msg-bubble.msg-in{align-self:flex-start;background:var(--bg-card);border:1px solid var(--line);}
.wifi-app .msg-bubble.msg-out{align-self:flex-end;background:var(--cyan-dim);border:1px solid var(--cyan);color:var(--text);}
.wifi-app .thread-input{display:flex;gap:8px;margin-top:12px;}
.wifi-app .thread-input input{flex:1;padding:11px 14px;border-radius:10px;border:1px solid var(--line);background:var(--bg-card);color:var(--text);font-family:var(--sans);}
.wifi-app .thread-input button{flex-shrink:0;}
`;
