// api/login.js
// Connexion : vérifie le code d'accès CÔTÉ SERVEUR (la liste des utilisateurs
// et de leurs PIN ne transite plus jamais vers un navigateur non connecté),
// puis délivre un jeton de session signé utilisé par /api/db et /api/storage.
//
// POST { role: "admin" | "technicien" | "client", code: "..." }
//  → 200 { ok: true, token, user }   (admin / technicien : ligne wifi_users)
//  → 200 { ok: true, token, client } (client : ligne wifi_clients)
//  → 401 { ok: false }               (code incorrect)
//  → 429 { ok: false, error }        (trop de tentatives — voir anti-forçage)

import { SUPABASE_URL, sbHeaders, signToken, envError, sleep } from "./_lib.js";

// Premier démarrage uniquement : si la table wifi_users est entièrement vide,
// ce code crée le compte Admin principal (même comportement que le mode démo).
const FIRST_RUN_ADMIN_PIN = "2580";

// Anti-forçage (brute-force) : on limite les tentatives échouées par IP + rôle.
// Au-delà de MAX_TENTATIVES échecs dans FENETRE_MS, on bloque BLOCAGE_MS.
// Un code à 4-6 chiffres n'est alors plus exhaustible : quelques milliers de
// combinaisons/jour au lieu de milliers/seconde.
const MAX_TENTATIVES = 8;
const FENETRE_MS = 15 * 60 * 1000;
const BLOCAGE_MS = 15 * 60 * 1000;

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: sbHeaders() });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text().catch(() => "")}`);
  return res.json();
}

// IP réelle du client (Vercel la place dans x-forwarded-for / x-real-ip).
function ipClient(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) return String(xff).split(",")[0].trim();
  return String(req.headers["x-real-ip"] || "inconnu");
}

// Lecture/écriture du compteur de tentatives. Best-effort : si la table
// wifi_login_attempts n'existe pas encore (migration non appliquée), on
// retourne null / on ignore → l'anti-forçage est simplement inactif, mais la
// connexion continue de fonctionner normalement.
async function lireTentative(cle) {
  try {
    const rows = await sbGet(`wifi_login_attempts?cle=eq.${encodeURIComponent(cle)}&limit=1`);
    return (rows && rows[0]) || null;
  } catch {
    return null;
  }
}
async function ecrireTentative(rec) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/wifi_login_attempts?on_conflict=cle`, {
      method: "POST",
      headers: sbHeaders({ "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify(rec),
    });
  } catch { /* best-effort */ }
}
async function effacerTentative(cle) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/wifi_login_attempts?cle=eq.${encodeURIComponent(cle)}`, {
      method: "DELETE",
      headers: sbHeaders(),
    });
  } catch { /* best-effort */ }
}

export default async (req, res) => {
  const err = envError();
  if (err) {
    res.status(500).json({ ok: false, error: err });
    return;
  }
  if (req.method !== "POST") {
    // Diagnostic sans données : /api/login?check=1 teste si la clé service
    // permet bien de joindre la base (renvoie juste le statut, jamais de données).
    if (req.method === "GET" && String(req.url || "").includes("check=1")) {
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/wifi_users?select=id&limit=1`, { headers: sbHeaders() });
        res.status(200).json({ ok: r.ok, supabase_status: r.status });
      } catch (e) {
        res.status(200).json({ ok: false, supabase_status: 0, error: String(e).slice(0, 200) });
      }
      return;
    }
    res.status(405).json({ ok: false, error: "Méthode non autorisée." });
    return;
  }

  const { role, code } = req.body || {};
  const cleanCode = String(code || "").trim();
  if (!cleanCode || !["admin", "technicien", "client"].includes(role)) {
    res.status(400).json({ ok: false, error: "Requête invalide." });
    return;
  }

  const cle = `${ipClient(req)}|${role}`;
  const maintenant = Date.now();

  // Déjà bloqué (trop de tentatives récentes) ? On refuse sans même vérifier le code.
  const tentative = await lireTentative(cle);
  if (tentative && tentative.bloque_jusqu && new Date(tentative.bloque_jusqu).getTime() > maintenant) {
    const minutes = Math.max(1, Math.ceil((new Date(tentative.bloque_jusqu).getTime() - maintenant) / 60000));
    res.status(429).json({ ok: false, error: `Trop de tentatives. Réessaie dans ${minutes} min.` });
    return;
  }

  // Enregistre un échec (fenêtre glissante) puis renvoie 401, ou 429 si le seuil
  // est atteint. Réutilisé par tous les chemins d'échec ci-dessous.
  const enregistrerEchec = async () => {
    let tentatives = 1;
    let fenetreDebut = maintenant;
    if (tentative) {
      const debut = new Date(tentative.fenetre_debut).getTime();
      if (maintenant - debut < FENETRE_MS) {
        tentatives = (tentative.tentatives || 0) + 1;
        fenetreDebut = debut;
      }
    }
    const bloque = tentatives >= MAX_TENTATIVES;
    await ecrireTentative({
      cle,
      tentatives,
      fenetre_debut: new Date(fenetreDebut).toISOString(),
      bloque_jusqu: bloque ? new Date(maintenant + BLOCAGE_MS).toISOString() : null,
    });
    if (bloque) {
      res.status(429).json({ ok: false, error: `Trop de tentatives. Réessaie dans ${Math.ceil(BLOCAGE_MS / 60000)} min.` });
    } else {
      await sleep(400); // ralentit aussi les tentatives en rafale
      res.status(401).json({ ok: false });
    }
  };

  try {
    if (role === "client") {
      // Recherche insensible à la casse, MAIS on neutralise d'abord les
      // jokers SQL (%, _, \) : sans cela, taper « % » comme code faisait
      // correspondre n'importe quel client et ouvrait son espace.
      const codeEchappe = cleanCode.toUpperCase().replace(/([%_\\])/g, "\\$1");
      const rows = await sbGet(`wifi_clients?access_code=ilike.${encodeURIComponent(codeEchappe)}&limit=1`);
      const client = rows && rows[0];
      if (!client) {
        await enregistrerEchec();
        return;
      }
      await effacerTentative(cle);
      const token = signToken({ sub: client.id, nom: client.nom, role: "client" });
      res.status(200).json({ ok: true, token, client });
      return;
    }

    // admin / technicien
    let rows = await sbGet(`wifi_users?role=eq.${role}&pin=eq.${encodeURIComponent(cleanCode)}&limit=1`);
    let user = rows && rows[0];

    if (!user && role === "admin" && cleanCode === FIRST_RUN_ADMIN_PIN) {
      const all = await sbGet("wifi_users?select=id&limit=1");
      if (!all || all.length === 0) {
        const createRes = await fetch(`${SUPABASE_URL}/rest/v1/wifi_users`, {
          method: "POST",
          headers: sbHeaders({ "Content-Type": "application/json", Prefer: "return=representation" }),
          body: JSON.stringify({ nom: "Admin", role: "admin", pin: FIRST_RUN_ADMIN_PIN, is_principal: true }),
        });
        if (createRes.ok) user = (await createRes.json())[0];
      }
    }

    if (!user) {
      await enregistrerEchec();
      return;
    }
    await effacerTentative(cle);
    const token = signToken({ sub: user.id, nom: user.nom, role: user.role });
    res.status(200).json({ ok: true, token, user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "Erreur serveur pendant la connexion." });
  }
};
