# Journal des versions — APESPOT WI-FI

## V10.4
Bilan PDF : le mois apparaît dans le nom du fichier.

- Le fichier s'enregistre désormais avec le mois en lettres, ex.
  **`Bilan-APESPOT-aout-2026.pdf`** (au lieu de `2026-08`), pour retrouver
  facilement chaque bilan.

## V10.3
Bilan comptable : PDF propre (fini les tableaux qui se chevauchent).

- **Bug** : sur mobile, l'export du bilan (via l'impression du navigateur)
  superposait les tableaux — document illisible.
- **Correctif** : le bilan est désormais généré comme un **vrai fichier PDF**
  (même moteur que les reçus), en A4, multi-pages, avec en-têtes de colonnes
  répétés à chaque page et numéros de page. Sur téléphone, le menu de partage
  s'ouvre (« Enregistrer dans Fichiers », WhatsApp…) ; sur ordinateur, le PDF
  se télécharge.

## V10.2
Position du local (dépenses admin) : confirmation « Es-tu à la base ? ».

- Avant d'enregistrer la position du local, l'app demande maintenant à l'admin
  **« Es-tu à la base principale ? »**.
  - **Oui** → capture GPS et enregistrement.
  - **Non** → rappel : *« Attends d'être à la base principale avant
    d'enregistrer sa position. »* (rien n'est enregistré).
- Même règle unique que pour la position des clients : un seul composant
  gère les deux cas (client / base), avec le bon libellé.

## V10.1
Position du client : enfin fonctionnelle pour le technicien (règle unique).

- **Cause du bug** : l'écran du technicien n'affichait pas le dialogue
  « Es-tu chez le client ? ». Le clic sur « Enregistrer la position » fermait
  simplement la fiche sans jamais lancer la capture GPS ni l'enregistrement.
- **Correctif** : le dialogue de position est désormais un **composant unique
  partagé** (`PositionDialogs`), affiché aussi bien côté admin que côté
  technicien. Une seule et même règle gère l'enregistrement de la position
  dans toute l'application.

## V10.0
Position du client : message honnête (fini le faux « enregistré »).

- Avant, l'app affichait « Position enregistrée » même quand la sauvegarde
  échouait (erreur avalée en silence). Corrigé : le succès n'est affiché que
  si la position est **réellement** enregistrée en base.
- En cas d'échec, un message précis explique la cause : autorisation de
  localisation refusée, GPS désactivé, délai dépassé, ou erreur base.

## V9.9
Fiche client (technicien) : plus d'espace entre les boutons.

- Le bouton **📞 Appeler** et le bouton **Enregistrer la position** ne sont
  plus collés — un espacement a été ajouté pour éviter les appuis par erreur.

## V9.8
Espace technicien : le numéro s'affiche après avoir ouvert le client.

- Le bouton **📞 Appeler** n'apparaît plus dans la liste : il s'affiche
  quand le technicien **appuie d'abord sur le client** (dans sa fiche).
- La liste reste épurée ; l'appel se lance depuis la fiche du client
  (toujours un appel téléphonique, aucune redirection WhatsApp).

## V9.7
Espace technicien : appeler le client directement.

- Chaque client de la liste du technicien affiche un bouton **📞 Appeler**
  avec le numéro du client. Un appui lance directement l'appel téléphonique
  (aucune redirection WhatsApp).
- Si le numéro n'est pas renseigné, la mention « Numéro non renseigné »
  s'affiche à la place.

## V9.6
Rappels WhatsApp : voir qui a déjà été relancé (coordination entre admins).

- Chaque client à notifier affiche désormais **✓ relancé** (vert) ou
  **⏳ à relancer** (orange) dans la liste. L'info est partagée entre tous les
  admins : dès qu'un admin envoie le rappel, les autres le voient.
- La « Relance groupée » ne repropose plus les clients déjà relancés
  aujourd'hui — un autre admin ne voit que ceux qui restent à faire.

## V9.5
Correctif : ouverture de WhatsApp plus fiable.

- Après un réabonnement/paiement (et lors de tout envoi WhatsApp), l'ouverture
  de WhatsApp se faisait via un nouvel onglet souvent bloqué sur mobile
  (« rien ne se passe »). On bascule maintenant automatiquement dans l'onglet
  courant en cas de blocage → WhatsApp s'ouvre à coup sûr.

## V9.4
Correctif : téléchargement des tickets PDF par le client.

- Le contrôle d'accès aux fichiers (ajouté en V9.0) refusait à tort le
  téléchargement d'un ticket dont le nom de fichier contenait des espaces,
  parenthèses ou accents. La vérification de propriété se fait désormais de
  façon fiable (comparaison en mémoire), sans passer le nom de fichier dans le
  filtre de la base.

## V9.3
Notification recadrée sur le vrai travail : **envoyer les rappels WhatsApp**.

- La notification dit désormais « X rappels WhatsApp à envoyer » (au lieu de
  « à renouveler ») — c'est le client qui renouvelle, notre rôle est d'envoyer
  le message.
- Ne compte que les clients dont l'échéance approche (avant expiration) et qui
  n'ont pas encore reçu leur rappel du jour.
- Dès que le rappel WhatsApp d'un client est envoyé, il disparaît du compteur
  pour la journée (il y revient le lendemain s'il n'a pas renouvelé).
- Une fois un client expiré, plus de rappel automatique (envoi manuel toujours
  possible).

## V9.2
Finitions (petits détails d'usage).

- Le clic sur une notification ouvre désormais la bonne page.
- Badge « messages non lus » qui se met à jour dès qu'on ouvre l'onglet.
- Brouillon de réclamation conservé si l'app se déconnecte pour inactivité.
- Écran de connexion : la minuterie de blocage s'arrête proprement.
- Journal d'activité rafraîchi automatiquement (comptes multiples).
- Accès au stockage local encore renforcé (aucune page blanche).
- Quelques totaux protégés contre un affichage erroné.

## V9.1
Robustesse des sessions et de l'affichage.

- **Session expirée** : l'application revient désormais vraiment à l'écran de
  connexion (avant, elle semblait connectée mais ne pouvait plus rien
  enregistrer).
- **Page blanche évitée** : accès au stockage local sécurisé (Safari en
  navigation privée / cookies bloqués ne font plus planter l'app).
- **Rafraîchissement automatique** : n'écrase plus une action juste effectuée
  (plus de « retour en arrière » passager d'un paiement marqué payé, etc.).

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
