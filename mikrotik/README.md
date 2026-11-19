# Synchro PPPoE APESPOT ↔ MikroTik

Coupe et réactive **automatiquement** les clients PPPoE sur les 4 serveurs
MikroTik, à partir des dates d'échéance déjà gérées dans APESPOT.

- **Couper** = désactiver le compte PPPoE + fermer la session en cours.
- **Activer** = réactiver le compte (la vitesse 30/50 Mbps est conservée).
- **Rapprochement** = par le **nom** (le login PPPoE sur le routeur = le nom du
  client dans APESPOT ; le champ « Login PPPoE » de la fiche n'est utile que
  pour les exceptions).

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
   Interval = `00:05:00`, On Event = `/system script run apespot-pppoe`.

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

## À durcir plus tard (optionnel)
- `check-certificate=no` est utilisé pour que le téléchargement HTTPS marche
  sans importer de certificat sur le MikroTik. Pour renforcer, importer la CA
  (ISRG Root X1 de Let's Encrypt) sur les routeurs et passer
  `check-certificate=yes`.
- Un **jeton différent par routeur** (au lieu d'un secret partagé) est possible
  si besoin.
