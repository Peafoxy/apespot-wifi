# Journal des versions — APESPOT WI-FI

## V9.0
Améliorations issues de l'audit de fiabilité et de sécurité.

- **Relance automatique** — le personnel reçoit une notification tant qu'il
  reste du travail en attente (paiements, demandes, abonnements) et que
  personne n'a ouvert l'application, en journée, toutes les 10 min.
- **Correctifs de fiabilité**
  - Tickets clients : plafond d'historique **par client** (ne supprime plus les
    tickets d'autres clients ; jamais un ticket en attente / prêt).
  - « Bénéfice net » mensuel : déduit les charges récurrentes seulement le mois
    où elles sont réglées.
  - Lignes FAI : correction de la dérive d'un jour sur les échéances de fin de mois.
- **Fiabilisation de la relance** : ne se répète plus indéfiniment (fenêtre
  actionnable), accès verrouillé, pannes rendues visibles.
- **Sécurité de la connexion**
  - Anti-forçage : blocage temporaire après trop de tentatives échouées.
  - Les codes admin ne sont plus accessibles à un technicien.
  - Codes générés à 6 chiffres (les codes existants restent valables).
- **Cloisonnement des clients**
  - Un client ne peut plus créer de message / réclamation / demande au nom d'un
    autre client.
  - Un client ne peut plus accéder aux fichiers (tickets) d'un autre client.
  - Noms de clients imposés uniques (clé de cloisonnement).

## V8.7 (et antérieures)
Version de départ : reçus générés à la demande, tickets conservés 24 h après
téléchargement, sécurisation Supabase (aucune clé dans le navigateur).
