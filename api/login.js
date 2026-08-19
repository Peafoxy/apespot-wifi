// api/login.js
// Connexion : vérifie le code d'accès CÔTÉ SERVEUR (la liste des utilisateurs
// et de leurs PIN ne transite plus jamais vers un navigateur non connecté),
// puis délivre un jeton de session signé utilisé par /api/db et /api/storage.
//
// POST { role: "admin" | "technicien" | "client", code: "..." }
//  → 200 { ok: true, token, user }   (admin / technicien : ligne wifi_users)
//  → 200 { ok: true, token, client } (client : ligne wifi_clients)
//  → 401 { ok: false }               (code incorrect)

import { SUPABASE_URL, sbHeaders, signToken, envError, sleep } from "./_lib.js";

// Premier démarrage uniquement : si la table wifi_users est entièrement vide,
// ce code crée le compte Admin principal (même comportement que le mode démo).
const FIRST_RUN_ADMIN_PIN = "2580";

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: sbHeaders() });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text().catch(() => "")}`);
  return res.json();
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

  try {
    if (role === "client") {
      // ilike sans joker = égalité insensible à la casse (les codes sont stockés en majuscules).
      const rows = await sbGet(`wifi_clients?access_code=ilike.${encodeURIComponent(cleanCode.toUpperCase())}&limit=1`);
      const client = rows && rows[0];
      if (!client) {
        await sleep(400); // ralentit les tentatives en rafale
        res.status(401).json({ ok: false });
        return;
      }
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
      await sleep(400);
      res.status(401).json({ ok: false });
      return;
    }
    const token = signToken({ sub: user.id, nom: user.nom, role: user.role });
    res.status(200).json({ ok: true, token, user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "Erreur serveur pendant la connexion." });
  }
};
