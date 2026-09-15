# Journal des versions — APESPOT WI-FI

## V11.7
Reconnexion : onglet actif correctement affiché même après le chargement.

- En production, à la reconnexion, les données se chargent encore quand on
  redevient admin (écran « Chargement… ») : la barre d'onglets n'existe pas
  encore, et le centrage échouait avant la fin du chargement.
- Le centrage se relance désormais **une fois le chargement terminé**
  (dépend de `loading`/`sessionChecked`), avec une fenêtre de ré-essai plus
  longue. L'onglet mémorisé s'affiche bien sélectionné à la reconnexion.

## V11.6
Reconnexion : l'onglet actif se cale aussi après déconnexion/reconnexion.

- V11.5 corrigeait le rafraîchissement, mais pas la reconnexion (déconnexion
  puis reconnexion) : l'écran admin n'étant pas recréé, la barre ne se
  recentrait pas sur l'onglet mémorisé (ex. Dépenses).
- Le centrage se relance désormais aussi **à la connexion**.

## V11.5
Reconnexion : la barre d'onglets se cale sur l'onglet affiché.

- À la reconnexion, l'app rouvrait le dernier onglet utilisé (ex. Dépenses) et
  affichait son contenu, mais la barre d'onglets restait au début — l'onglet
  actif était hors écran, donc aucun ne paraissait sélectionné.
- Désormais la barre **défile automatiquement jusqu'à l'onglet actif** (centré
  et souligné), côté admin, technicien et client.

## V11.4
Logo agrandi et rendu plus net.

- Logo ré-généré en plus grande résolution (×3) avec un renforcement de
  netteté, et légèrement agrandi (en-tête et écran de connexion).
- Note : la netteté finale reste limitée par la petite taille du fichier
  d'origine — pour un rendu vraiment HD, fournir le logo original haute
  résolution (PNG transparent ou SVG).

## V11.3
Logo sans fond blanc, intégré au thème sombre.

- Le fond blanc du logo a été **retiré** (rendu transparent) et l'image
  ré-encodée proprement — fini le carré blanc autour du logo.
- Le carré/ombre blanc en CSS a été supprimé : le logo s'affiche directement
  sur le fond sombre, dans l'en-tête comme sur l'écran de connexion.

## V11.2
Position : capture GPS fiable en intérieur (mise à jour enfin possible).

- **Problème** : chez le client (en intérieur, près du routeur), le GPS haute
  précision dépassait souvent 10 s → échec → le technicien n'arrivait pas à
  (ré)actualiser la position.
- **Correctif** : nouvelle capture en 2 temps — d'abord GPS haute précision
  **frais** avec un délai généreux (20 s), puis, si le GPS traîne, un **2ᵉ essai
  réseau/cellule** rapide au lieu d'abandonner. Un message « Recherche de la
  position en cours… » s'affiche, et en cas d'échec la cause exacte est indiquée.
- La position primaire est toujours **fraîche** : aucun risque de récupérer une
  ancienne position « prise ailleurs ».
- Appliqué partout : position client (fiche & réclamation), position de départ
  du technicien, et position du local.

## V11.1
Onglets plus lisibles.

- Les onglets inactifs passent d'un gris foncé à un **blanc cassé** bien
  visible ; l'onglet survolé devient **blanc**. L'onglet actif reste teal.

## V11.0
Nouveau look : fond sombre soigné, cartes avec de la profondeur.

- Fond profond avec une **lueur teal** signature (dégradés discrets) au lieu du
  fond plat.
- Les **cartes** (statistiques, panneaux, tableaux) ont un léger dégradé, un
  **filet lumineux** et une **ombre douce** — effet de relief.
- Les **cartes de statistiques** ont une **lueur de couleur** selon leur état
  (rouge / orange / vert / cyan) et une barre d'accent lumineuse.
- L'**onglet actif** brille légèrement (teal).

## V10.9
Affichage : l'app occupe toute la largeur de l'écran.

- Suppression de la largeur fixe (1126 px) héritée du gabarit de départ qui
  laissait des **bandes blanches** de chaque côté sur grand écran.
- Le fond de page est désormais sombre (couleur de l'app) — plus de blanc sur
  les côtés ni au rebond de défilement.

## V10.8
Connexion : l'œil (afficher/masquer le code) est maintenant dans la ligne.

- L'icône œil du champ « Code d'accès » est placée **à l'intérieur** du champ
  (à droite), au lieu d'un carré séparé à côté. Le texte reste centré.

## V10.7
Caisse : caisse commune, dépenses déduites automatiquement.

- La caisse est désormais **commune** (plus de distinction par personne).
- **Reste à verser = Total encaissé − Dépenses (carburant + perdiem + autres)
  − Déjà versé** — les dépenses sont soustraites automatiquement.
- L'onglet Caisse montre le **calcul détaillé** (encaissé, chaque dépense
  déduite, déjà versé, reste à verser) + l'historique des versements.
- Le formulaire de versement est simplifié : montant, date, remis par
  (optionnel), reçu par (optionnel), note.
- Les « lignes » (abonnements récurrents) ne sont pas déduites de la caisse
  (elles restent une charge du bilan comptable).
- **Correctif important** : le champ « qui encaisse » (V10.6) est retiré des
  paiements — il aurait fait échouer l'enregistrement d'un paiement tant que la
  migration n'était pas lancée.
- **Migration à exécuter** dans Supabase (SQL Editor) :
  `supabase/caisse-versements.sql` — crée uniquement la table des versements.

## V10.6
Caisse & versements : première version (par personne) — remplacée par V10.7.

## V10.5
PDF sur ordinateur : téléchargement direct (plus de menu « Partager »).

- Sur **ordinateur**, les PDF (bilan et reçus) se **téléchargent** directement
  dans le dossier Téléchargements. On n'ouvre plus le menu « Partager » de
  Windows (qui ne proposait que téléphone/WhatsApp). Pour imprimer : ouvrir le
  fichier téléchargé puis **Ctrl+P**.
- Sur **téléphone**, rien ne change : le menu de partage s'ouvre toujours
  (« Enregistrer dans Fichiers », WhatsApp…).

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
