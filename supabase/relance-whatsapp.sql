-- ============================================================================
-- APESPOT WI-FI — Rappels WhatsApp : mémoriser la date du dernier rappel
-- ============================================================================
-- Ajoute une colonne à wifi_clients qui retient le jour où le rappel WhatsApp
-- a été envoyé à un client. Le compteur « rappels WhatsApp à envoyer » (dans
-- /api/relance-activite) ne compte alors QUE les clients de la fenêtre
-- d'échéance qui n'ont pas encore reçu leur rappel du jour.
--
-- À exécuter UNE FOIS dans le SQL Editor de Supabase. Sans effet si déjà fait.
-- Tant que ce n'est pas exécuté, la relance fonctionne quand même : elle compte
-- simplement toute la fenêtre d'échéance sans le filtre « déjà relancé
-- aujourd'hui » (l'endpoint gère l'absence de colonne).
-- ============================================================================
alter table public.wifi_clients
  add column if not exists relance_le date;
