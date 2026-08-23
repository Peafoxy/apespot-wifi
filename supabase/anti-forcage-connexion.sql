-- ============================================================================
-- APESPOT WI-FI — Anti-forçage de la connexion (limite des tentatives)
-- ============================================================================
-- Crée la table qui compte les tentatives de connexion échouées par IP + rôle.
-- /api/login s'en sert pour bloquer temporairement (15 min) après trop d'échecs
-- (8 dans une fenêtre de 15 min) — le forçage d'un code devient impraticable.
--
-- À exécuter UNE FOIS dans le SQL Editor de Supabase. Sans effet si déjà fait.
-- Tant que ce n'est pas exécuté, la connexion fonctionne normalement ; seule la
-- limite de tentatives reste inactive (l'endpoint ignore l'absence de table).
-- ============================================================================
create table if not exists public.wifi_login_attempts (
  cle            text primary key,               -- identifiant IP + rôle
  tentatives     integer not null default 0,
  fenetre_debut  timestamptz not null default now(),
  bloque_jusqu   timestamptz
);

-- Même régime de sécurité que les autres tables wifi_* : RLS activé, aucun
-- droit pour anon / authenticated. Seul le serveur (service_role) y accède.
alter table public.wifi_login_attempts enable row level security;
revoke all on table public.wifi_login_attempts from anon, authenticated;
