# APESPOT WI-FI

## Sécurité Supabase (v7.1)

Le navigateur ne contient plus aucune clé Supabase. Tous les accès à la base
passent par les fonctions serveur Vercel :

- `/api/login` — vérifie le PIN (admin/technicien) ou le code d'accès (client)
  côté serveur et délivre un jeton de session signé (valable 24 h) ;
- `/api/db` — proxy vers PostgREST avec la clé `service_role`, réservé aux
  sessions valides (les sessions "client" n'ont pas accès aux tables du
  personnel : `wifi_users`, `wifi_activity_log`, dépenses…) ;
- `/api/storage` — upload / suppression / URLs signées pour les buckets
  privés `tickets` et `receipts` ;
- `/api/send-daily-reminder` — notifications push (cron 8h en GET ; envoi
  manuel en POST réservé aux sessions connectées).

### Mise en service (à faire une fois)

1. **Variables d'environnement sur Vercel** (Settings → Environment Variables) :
   - `SUPABASE_URL` — l'URL du projet (déjà en place) ;
   - `SUPABASE_SERVICE_ROLE_KEY` — clé *service_role* (Supabase → Settings →
     API). Ne jamais la mettre dans le code ;
   - `APP_SESSION_SECRET` — chaîne aléatoire longue (ex. `openssl rand -hex 32`) ;
   - `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` — inchangées.
   - (`SUPABASE_ANON_KEY` et `ADMIN_NOTIFY_SECRET` ne servent plus.)
2. **Déployer** cette version de l'application.
3. **Exécuter `supabase/security-rls.sql`** dans le SQL Editor de Supabase :
   active le RLS sur toutes les tables `wifi_*` (la clé anon publique perd
   tout accès — c'est ce que réclamait le Security Advisor).
4. **Passer les buckets `tickets` et `receipts` en privé** (Storage →
   Configuration du bucket → décocher "Public bucket").
5. Comme l'ancienne clé anon a été publiée dans le code, **la régénérer**
   (Supabase → Settings → API → "Reset" / JWT secret rotation) — attention :
   l'autre application (BMI-Gestions Boutiques) qui partage ce projet devra
   recevoir la nouvelle clé.

Les erreurs restantes du Security Advisor (`demandes_devis`,
`catalogue_public`…) appartiennent à l'autre application du même projet
Supabase et ne sont pas couvertes ici.

### Développement local

Sur `localhost`, l'application passe automatiquement en **mode démo**
(données de démonstration en localStorage, aucune connexion à Supabase).
Pour tester les fonctions serveur en local : `vercel dev` puis, dans la
console du navigateur, `localStorage.setItem("apespot-force-backend", "1")`.

---

# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.
