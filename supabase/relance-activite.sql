-- ============================================================================
-- APESPOT WI-FI — Relance automatique « travail en attente »
-- ============================================================================
-- Rappelle au personnel (notification push) qu'il reste des éléments à traiter
-- TANT QUE personne n'a ouvert l'application. Vérification toutes les 10 min,
-- en journée. À exécuter UNE FOIS dans le SQL Editor de Supabase.
--
-- Ce script :
--   1. crée la table de présence `wifi_presence` (une seule ligne) que
--      l'application met à jour quand un membre du personnel a l'app ouverte ;
--   2. planifie l'appel de /api/relance-activite toutes les 10 min via pg_cron
--      (gratuit — pas besoin du plan Vercel Pro).
-- ============================================================================

-- ---- 1. Table de présence --------------------------------------------------
create table if not exists public.wifi_presence (
  id            integer primary key default 1,
  last_seen_at  timestamptz,
  last_seen_by  text,
  constraint wifi_presence_ligne_unique check (id = 1)
);

insert into public.wifi_presence (id, last_seen_at)
values (1, now())
on conflict (id) do nothing;

-- Même régime de sécurité que les autres tables wifi_* : RLS activé, aucun
-- droit pour anon / authenticated. Seul le serveur (service_role) y accède.
alter table public.wifi_presence enable row level security;
revoke all on table public.wifi_presence from anon, authenticated;

-- ---- 2. Planification toutes les 10 min (pg_cron + pg_net) -----------------
-- pg_cron exécute une tâche planifiée ; pg_net permet d'appeler une URL HTTPS.
-- Les deux sont fournis par Supabase (à activer dans Database → Extensions si
-- ce n'est pas déjà fait — ces `create extension` sont sans effet s'ils le sont).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ⚠️ AVANT D'EXÉCUTER, remplacer les deux valeurs ci-dessous :
--   <VOTRE-DOMAINE>       = l'URL de l'app en production
--                          (ex. apespot-wifi.vercel.app — SANS https:// ici,
--                           il est déjà écrit dans l'URL plus bas)
--   <RELANCE_CRON_SECRET> = exactement la même chaîne que la variable
--                          d'environnement `RELANCE_CRON_SECRET` sur Vercel.
select cron.schedule(
  'apespot-relance-activite',
  '*/10 * * * *',
  $$
  select net.http_get(
    url := 'https://<VOTRE-DOMAINE>/api/relance-activite?cle=<RELANCE_CRON_SECRET>'
  );
  $$
);

-- ---- Commandes utiles (à garder sous la main) ------------------------------
-- Voir les tâches planifiées :   select * from cron.job;
-- Voir les dernières exécutions : select * from cron.job_run_details order by start_time desc limit 20;
-- Arrêter la relance :           select cron.unschedule('apespot-relance-activite');
--
-- ---- Variante SANS pg_cron (si vous préférez le cron de Vercel) ------------
-- Le plan gratuit de Vercel limite les crons (souvent 1×/jour) : « toutes les
-- 10 min » demande le plan Pro. Dans ce cas, ne PAS lancer le bloc pg_cron
-- ci-dessus et ajouter plutôt dans vercel.json :
--   { "path": "/api/relance-activite?cle=<RELANCE_CRON_SECRET>", "schedule": "*/10 * * * *" }
-- ⚠️ Le secret est désormais OBLIGATOIRE (l'endpoint refuse tout appel non
--    authentifié — « fail-closed »). Mettez le même secret que la variable
--    d'environnement Vercel dans l'URL ci-dessus.
-- ============================================================================
