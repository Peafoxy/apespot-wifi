# Synchro PPPoE APESPOT ↔ MikroTik

Coupe et réactive **automatiquement** les clients PPPoE sur les 4 serveurs
MikroTik, à partir des dates d'échéance déjà gérées dans APESPOT.

- **Couper** = désactiver le compte PPPoE + fermer la session en cours.
- **Activer** = réactiver le compte (la vitesse 30/50 Mbps est conservée).
- **Rapprochement** = par le **nom** (le login PPPoE sur le routeur = le nom du
  client dans APESPOT ; le champ « Login PPPoE » de la fiche n'est utile que
  pour les exceptions).
- **Chaque routeur gère SES propres comptes** : il envoie la liste de ses
  comptes, le site répond par le nom. L'étiquette « serveur » (V6/V11/…) reste
  dans APESPOT pour l'affichage et sert à nommer les comptes importés, mais elle
  ne sert PAS à décider qui gère quoi. Un routeur gère donc tout ce qu'il
  contient, quelle que soit la répartition.

## Pièces
- `api/pppoe-sync.js` — adresse sécurisée côté APESPOT. Pour un serveur donné,
  renvoie la liste « activer / couper ». **Lecture seule**, ne touche jamais
  aux routeurs.
- `mikrotik/pppoe-sync.rsc` — script à coller sur **chaque** MikroTik. Il
  télécharge la liste de SON serveur et applique localement.

## Installation (une fois)

### 1. Un secret partagé sur Vercel
Dans le projet Vercel d'APESPOT → **Settings → Environment Variables** :
- Nom : `PPPOE_SYNC_SECRET`
- Valeur : un mot de passe long que **tu choisis** (ex. 24 caractères).

Puis **redéployer** pour que la variable soit prise en compte.

### 2. Le script sur chaque routeur
Pour **chacun** des 4 MikroTik :
1. **System → Scripts → (+)** : Name = `apespot-pppoe`, colle tout le contenu
   de `pppoe-sync.rsc`.
2. En haut du script, règle :
   - `serveur` = `V6`, `V11`, `V12` ou `H2` selon le routeur,
   - `token` = **la même valeur** que `PPPOE_SYNC_SECRET`,
   - `appliquer` = `false` (**mode test** pour commencer).
3. **System → Scheduler → (+)** : Name = `apespot-pppoe`,
   Interval = `00:02:00`, On Event = `/system script run apespot-pppoe`.
   *(2 min = reconnexion quasi immédiate après paiement. 5 min marche aussi ;
   descendre à 1 min n'apporte pas grand-chose de plus.)*

### 3. Tester sans rien couper
Avec `appliquer=false`, lance le script une fois
(`/system script run apespot-pppoe`) puis regarde **Log** : tu verras des
lignes « couperait X » / « activerait Y ». Vérifie que ça correspond à la
réalité (compare avec l'écran APESPOT du même serveur).

### 4. Activer pour de vrai
Quand les logs sont bons, passe `appliquer=true` dans le script. Les coupures
et activations se font alors toutes les 5 minutes.

## Sécurités intégrées
- **Cloud muet → aucune action** : si le téléchargement échoue ou si la réponse
  n'a pas le marqueur `#APESPOT`, le script ne touche à rien (une panne internet
  ne déconnecte jamais tous les clients).
- **On ne touche qu'aux comptes nommés par APESPOT** : un compte présent sur le
  routeur mais inconnu d'APESPOT (ex. compte admin/test) n'est jamais modifié.
- **Mode test** (`appliquer=false`) pour tout vérifier avant d'agir.

## Remontée automatique des comptes (Phase 3)
En **mode réel** (`appliquer=true`), le script envoie aussi la liste des comptes
**actifs** de son routeur. APESPOT crée automatiquement ceux qu'il ne connaît
pas encore — **sans date d'échéance**. Ils apparaissent dans l'app « à
compléter » ; il suffit d'ouvrir leur fiche et de mettre la date (le site
propose **+1 mois** d'un clic).

- **Sans date = jamais touché** : un compte importé n'est ni coupé ni activé
  tant que tu ne lui as pas mis de date. Aucune mauvaise date n'est écrite.
- **En mode test** (`appliquer=false`), rien n'est remonté ni créé.
- Au plus 100 créations par passage (garde-fou).

## Suppression automatique des comptes inactifs (3 mois)
Un compte **jamais vu connecté depuis 3 mois** est supprimé (le Secret sur le
routeur ; la fiche APESPOT est **conservée** avec son historique).

**Comment la dernière connexion est mesurée (fiable) :** on ne lit PAS la date
sur le routeur (format différent v6/v7). À chaque visite, le routeur envoie la
liste des comptes **connectés maintenant**, et APESPOT note « vu connecté ». Un
compte non vu depuis 3 mois (et suivi depuis au moins 3 mois) devient « à
supprimer ».

⚠️ **Le suivi démarre au lancement** : la suppression devient donc pleinement
effective **3 mois après** la mise en route (aucun compte supprimé avant).

**Sécurités :**
- Interrupteur **séparé** `supprimer` dans le script (par défaut `false`).
- Avec `supprimer=false`, le script écrit seulement *« supprimerait X »* dans le
  Log → tu vérifies la liste **avant** d'activer la vraie suppression.
- Jamais un compte connecté au moment de la visite.
- Un compte supprimé dont la fiche reste dans APESPOT : s'il repaie, tu
  recrées son Secret et il repart normalement.

## À durcir plus tard (optionnel)
- `check-certificate=no` est utilisé pour que le téléchargement HTTPS marche
  sans importer de certificat sur le MikroTik. Pour renforcer, importer la CA
  (ISRG Root X1 de Let's Encrypt) sur les routeurs et passer
  `check-certificate=yes`.
- Un **jeton différent par routeur** (au lieu d'un secret partagé) est possible
  si besoin.
