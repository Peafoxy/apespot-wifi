-- ============================================================================
-- APESPOT WI-FI — Caisse & versements (suivi de l'argent en main)
-- ============================================================================
-- Objectif : suivre, PAR PERSONNE, l'argent encaissé auprès des clients, les
-- versements (argent remis à l'administration / déposé), et ce qui reste en
-- main (solde de caisse = encaissé − versé).
--
-- 1) On mémorise QUI encaisse chaque paiement (colonnes ajoutées à wifi_payments).
--    Les anciens paiements restent sans collecteur : ils apparaissent regroupés
--    sous « Non attribué » dans la caisse.
-- 2) Nouvelle table wifi_versements : chaque remise d'argent (qui verse, combien,
--    quand, à qui, note).
--
-- À exécuter UNE FOIS dans le SQL Editor de Supabase. Sans effet si déjà fait.
-- Tant que ce n'est pas exécuté : l'app continue de fonctionner, mais la section
-- Caisse restera vide (aucun collecteur mémorisé, aucun versement possible).
-- ============================================================================

-- 1. Qui a encaissé chaque paiement
alter table public.wifi_payments
  add column if not exists encaisse_par    text,
  add column if not exists encaisse_par_id text;

-- 2. Table des versements
create table if not exists public.wifi_versements (
  id            uuid primary key default gen_random_uuid(),
  verse_par     text,                       -- nom de la personne qui verse
  verse_par_id  text,                       -- id de la personne qui verse
  montant       numeric not null,
  date          date not null,
  recu_par      text,                       -- à qui l'argent est remis (optionnel)
  note          text,
  created_at    timestamptz not null default now()
);

-- Même régime de sécurité que les autres tables wifi_* : RLS activé, aucun droit
-- pour anon / authenticated. Seul le serveur (service_role) y accède, via /api/db.
alter table public.wifi_versements enable row level security;
revoke all on table public.wifi_versements from anon, authenticated;
