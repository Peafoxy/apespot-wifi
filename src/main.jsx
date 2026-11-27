import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Enregistre le service worker dès le chargement, pour qu'Android puisse
// installer l'app en VRAIE application plein écran (WebAPK) et pas en raccourci.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

// ---- Détection automatique d'une nouvelle version déployée ----
// On compare le nom du fichier JS actuellement chargé avec celui servi par le
// serveur (rechargé sans cache). S'il a changé = une nouvelle version est en
// ligne -> on affiche une bannière « Recharger » (non bloquante). L'utilisateur
// n'a plus à vider le cache à la main à chaque mise à jour.
(function surveillerVersion() {
  const scripts = Array.prototype.slice.call(document.querySelectorAll("script"));
  const actuel = scripts.map((s) => s.src).find((s) => /\/assets\/index-[\w-]+\.js/.test(s || ""));
  if (!actuel) return;
  let afichee = false;
  function afficherBanniere() {
    if (afichee) return;
    afichee = true;
    const bar = document.createElement("div");
    bar.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#3ED8C3;color:#04100e;font:600 14px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:12px 16px;display:flex;align-items:center;justify-content:center;gap:14px;box-shadow:0 -4px 20px rgba(0,0,0,.35)";
    const txt = document.createElement("span");
    txt.textContent = "🔄 Nouvelle version disponible.";
    const btn = document.createElement("button");
    btn.textContent = "Recharger";
    btn.style.cssText = "background:#04100e;color:#3ED8C3;border:none;border-radius:8px;padding:7px 18px;font-weight:700;cursor:pointer;font-size:14px";
    btn.onclick = function () { location.reload(); };
    bar.appendChild(txt);
    bar.appendChild(btn);
    document.body.appendChild(bar);
  }
  async function verifier() {
    try {
      const res = await fetch("/?_v=" + Date.now(), { cache: "no-store" });
      if (!res.ok) return;
      const html = await res.text();
      const m = html.match(/\/assets\/index-[\w-]+\.js/);
      if (!m) return;
      const dernier = new URL(m[0], location.origin).href;
      if (dernier !== actuel) afficherBanniere();
    } catch (e) { /* hors-ligne ou erreur : on réessaiera */ }
  }
  setTimeout(verifier, 15000);
  setInterval(verifier, 3 * 60 * 1000);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") verifier();
  });
})();
