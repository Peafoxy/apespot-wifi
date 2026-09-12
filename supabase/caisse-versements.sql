-- ============================================================================
-- APESPOT WI-FI — Caisse & versements (suivi de l'argent à verser)
-- ============================================================================
-- Objectif : suivre une CAISSE COMMUNE. Le « reste à verser » est calculé
-- automatiquement :
--
--     Reste à verser = Total encaissé − Dépenses (carburant + perdiem + autres)
--                                       − Total déjà versé
--
-- Cette migration crée UNIQUEMENT la table des versements (l'argent remis à
-- l'administration / déposé). Le reste du calcul utilise les paiements et les
-- dépenses déjà existants — aucune autre modification de schéma nécessaire.
--
-- À exécuter UNE FOIS dans le SQL Editor de Supabase. Sans effet si déjà fait.
-- Tant que ce n'est pas exécuté : l'app fonctionne, mais on ne peut pas
-- enregistrer de versement (l'onglet Caisse affiche quand même l'encaissé et
-- les dépenses ; « déjà versé » reste à 0).
-- ============================================================================

create table if not exists public.wifi_versements (
  id            uuid primary key default gen_random_uuid(),
  verse_par     text,                       -- nom de la personne qui remet l'argent (info)
  verse_par_id  text,                       -- réservé (non utilisé aujourd'hui)
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
