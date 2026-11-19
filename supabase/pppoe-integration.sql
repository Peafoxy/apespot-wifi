-- ============================================================================
-- APESPOT WI-FI — Intégration PPPoE (coupure / activation automatique)
-- ============================================================================
-- Étape 1 (base de données) : on ajoute à chaque client son LOGIN PPPoE, le
-- nom exact de son compte sur le MikroTik (menu PPP → Secrets). C'est ce nom
-- qui permettra de couper (date d'expiration dépassée) ou de réactiver
-- (réabonnement) le client automatiquement, sans toucher au routeur à la main.
--
-- Le serveur du client (lequel des 4 MikroTik) est DÉJÀ stocké dans la colonne
-- wifi_clients.serveur — on ne la recrée donc pas ici.
--
-- À exécuter UNE FOIS dans le SQL Editor de Supabase. Sans effet si déjà fait
-- (IF NOT EXISTS). Tant que ce n'est pas exécuté : l'app fonctionne normalement,
-- mais le champ « Login PPPoE » de la fiche client ne sera pas sauvegardé.
-- ============================================================================

alter table public.wifi_clients
  add column if not exists pppoe_login text;

-- Suivi des connexions, pour la SUPPRESSION automatique des comptes inactifs
-- depuis 3 mois (voir api/pppoe-sync.js). APESPOT note lui-meme quand un compte
-- est vu connecte (pas de lecture de date sur le routeur, peu fiable v6/v7).
--   derniere_connexion_vue : derniere fois vu connecte.
--   suivi_depuis           : debut du suivi (grace de 3 mois avant suppression).
alter table public.wifi_clients
  add column if not exists derniere_connexion_vue timestamptz,
  add column if not exists suivi_depuis timestamptz;

-- Rappel sécurité : wifi_clients reste protégé par RLS (voir security-rls.sql).
-- Aucun droit pour anon / authenticated ; seul le serveur (service_role) y
-- accède, via /api/db. Cette colonne hérite de ce régime, rien à changer.
