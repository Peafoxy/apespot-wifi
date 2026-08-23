-- ============================================================================
-- APESPOT WI-FI — Anti-répétition de la relance automatique
-- ============================================================================
-- Ajoute une colonne à `wifi_presence` pour mémoriser l'heure de la dernière
-- relance envoyée. L'endpoint /api/relance-activite s'en sert pour ne pas
-- envoyer deux notifications trop rapprochées (protège d'un double
-- planificateur ou d'appels répétés).
--
-- À exécuter UNE FOIS dans le SQL Editor de Supabase. Sans effet si déjà fait.
-- Tant que ce n'est pas exécuté, la relance fonctionne quand même : seul
-- l'anti-répétition reste inactif (l'endpoint ignore l'absence de colonne).
-- ============================================================================
alter table public.wifi_presence
  add column if not exists derniere_relance_at timestamptz;
