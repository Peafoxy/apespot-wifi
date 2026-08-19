-- ============================================================================
-- APESPOT WI-FI — Sécurisation Supabase (Security Advisor : "RLS Disabled in Public")
-- ============================================================================
-- À exécuter UNE FOIS dans le SQL Editor de Supabase (projet "BMI APP"),
-- APRÈS avoir déployé la version de l'application qui passe par les fonctions
-- serveur Vercel (/api/db, /api/login, /api/storage) — sinon l'application
-- perdra l'accès à la base.
--
-- Principe :
--   1. On active le Row Level Security (RLS) sur toutes les tables wifi_*.
--   2. On ne crée AUCUNE policy pour les rôles anon / authenticated :
--      RLS activé sans policy = accès refusé. La clé publique "anon" ne peut
--      donc plus rien lire ni écrire dans ces tables.
--   3. L'application accède désormais à la base uniquement via les fonctions
--      serveur Vercel, qui utilisent la clé "service_role" (jamais exposée au
--      navigateur). Le rôle service_role ignore le RLS : rien d'autre à faire.
--
-- NOTE : les autres erreurs du Security Advisor (public.demandes_devis,
-- vue public.catalogue_public en SECURITY DEFINER, etc.) appartiennent à
-- l'autre application qui partage ce projet Supabase (BMI-Gestions Boutiques)
-- et ne sont pas traitées par ce script.
-- ============================================================================

-- ---- 1. Activer le RLS sur toutes les tables de l'application WiFi ----

alter table if exists public.wifi_clients             enable row level security;
alter table if exists public.wifi_payments            enable row level security;
alter table if exists public.wifi_messages            enable row level security;
alter table if exists public.wifi_complaints          enable row level security;
alter table if exists public.wifi_users               enable row level security;
alter table if exists public.wifi_payment_requests    enable row level security;
alter table if exists public.wifi_ticket_requests     enable row level security;
alter table if exists public.wifi_ticket_durations    enable row level security;
alter table if exists public.wifi_settings            enable row level security;
alter table if exists public.wifi_activity_log        enable row level security;
alter table if exists public.wifi_fuel_expenses       enable row level security;
alter table if exists public.wifi_expense_lines       enable row level security;
alter table if exists public.wifi_perdiem             enable row level security;
alter table if exists public.wifi_other_expenses      enable row level security;
alter table if exists public.wifi_push_subscriptions  enable row level security;

-- ---- 2. Ceinture et bretelles : retirer aussi les droits SQL directs ----
-- (RLS sans policy bloque déjà tout, mais on retire en plus les GRANT
--  hérités par défaut, uniquement sur les tables wifi_*.)

do $$
declare
  t text;
begin
  foreach t in array array[
    'wifi_clients', 'wifi_payments', 'wifi_messages', 'wifi_complaints',
    'wifi_users', 'wifi_payment_requests', 'wifi_ticket_requests',
    'wifi_ticket_durations', 'wifi_settings', 'wifi_activity_log',
    'wifi_fuel_expenses', 'wifi_expense_lines', 'wifi_perdiem',
    'wifi_other_expenses', 'wifi_push_subscriptions'
  ] loop
    if exists (select 1 from pg_tables where schemaname = 'public' and tablename = t) then
      execute format('revoke all on table public.%I from anon, authenticated', t);
    end if;
  end loop;
end $$;

-- ============================================================================
-- 3. Stockage (buckets "tickets" et "receipts") — à faire dans le Dashboard :
--    Storage → tickets → Configuration → décocher "Public bucket"
--    Storage → receipts → Configuration → décocher "Public bucket"
--    puis supprimer les éventuelles policies permissives sur storage.objects
--    pour ces buckets (Storage → Policies).
--    L'application lit désormais les fichiers via des URLs signées générées
--    côté serveur (/api/storage?action=sign), donc les buckets peuvent être
--    entièrement privés.
-- ============================================================================
