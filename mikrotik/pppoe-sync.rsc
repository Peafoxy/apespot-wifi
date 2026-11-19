# ===========================================================================
# APESPOT WI-FI — Synchro PPPoE (coupure / activation automatique)
# ---------------------------------------------------------------------------
# A COLLER dans le MikroTik :
#   1) System > Scripts > (+) : Name = apespot-pppoe, colle TOUT ce texte.
#   2) System > Scheduler > (+) : Name = apespot-pppoe, Interval = 00:05:00,
#      On Event = /system script run apespot-pppoe
# Compatible RouterOS v6 ET v7.
#
# A FAIRE SUR CHAQUE ROUTEUR : changer "serveur" (V6/V11/V12/H2) et "token".
# Laisse "appliquer=false" au DEBUT (mode test : ca ne coupe personne, ca
# ecrit seulement dans Log ce qu'il FERAIT). Quand les logs sont bons, passe
# "appliquer=true".
# La SUPPRESSION des comptes inactifs (3 mois) a son propre interrupteur
# "supprimer" (par defaut false = ne supprime jamais, ecrit juste dans Log).
# ===========================================================================

# ---- A MODIFIER SUR CHAQUE ROUTEUR ----------------------------------------
:local serveur "V11"
# ^ etiquette de CE routeur (V6, V11, V12 ou H2). Sert a NOMMER les comptes
#   nouvellement importes et a l'affichage dans APESPOT. La coupure/activation
#   se fait par le NOM : ce routeur gere TOUS les comptes qu'il contient.

:local token "METS-ICI-TON-SECRET"
# ^ exactement la meme valeur que la variable PPPOE_SYNC_SECRET sur Vercel

:local appliquer false
# ^ false = TEST (ecrit seulement dans Log, ne coupe/active personne)
#   true  = applique vraiment les coupures et les activations

:local supprimer false
# ^ SUPPRESSION des comptes inactifs depuis 3 mois (dernier recours).
#   false = ne supprime JAMAIS (ecrit seulement "supprimerait X" dans Log)
#   true  = supprime vraiment le compte (Secret) sur le routeur
#   Laisse false tant que tu n'as pas verifie la liste dans Log.
# ---------------------------------------------------------------------------

:local base "https://apespot-wifi.vercel.app/api/pppoe-sync"
:local fichier "apespot-pppoe.txt"

# La REQUETE est courte : on ne met QUE le token dans l'URL. Le site renvoie la
# liste des decisions (E/D/X) pour tous les clients, et ce routeur n'applique
# qu'aux comptes qu'il possede. Plus jamais de timeout, quel que soit le nombre
# de comptes.
:local url ($base . "?serveur=" . $serveur . "&token=" . $token)

# 1) Telecharger la liste depuis APESPOT.
# NB RouterOS v7 : ne PAS mettre "mode=https" (conflit avec l'URL https://).
:do {
  /tool fetch url=$url check-certificate=no dst-path=$fichier
} on-error={
  :log warning "APESPOT PPPoE: echec du telechargement, aucune action."
  :error "fetch"
}
:delay 2s

# 2) Lire le fichier recu.
:local data ""
:do { :set data [/file get [find name=$fichier] contents] } on-error={ :set data "" }

# 3) Garde-fou : ne RIEN faire si la reponse n'est pas valide (marqueur APESPOT).
#    Protege d'une page d'erreur ou d'un telechargement coupe -> on ne coupe
#    jamais les clients sur une reponse douteuse.
:if (([:len $data] < 8) || ([:pick $data 0 8] != "#APESPOT")) do={
  :log warning "APESPOT PPPoE: reponse invalide, aucune action."
  :error "invalide"
}

# 4) Parcourir les lignes (on ajoute un saut final pour traiter la derniere).
:set data ($data . "\n")
:local line ""
:local nbCoupe 0
:local nbActive 0
:local nbSuppr 0
:local n ([:len $data])
:for i from=0 to=($n - 1) do={
  :local ch [:pick $data $i ($i + 1)]
  :if (($ch = "\n") || ($ch = "\r")) do={
    :if (([:len $line] >= 3) && ([:pick $line 0 1] != "#")) do={
      :local action [:pick $line 0 1]
      :local nom [:pick $line 2 [:len $line]]
      :local sec [/ppp secret find name=$nom]
      :if ([:len $sec] > 0) do={
        :if ($action = "D") do={
          :if ($appliquer) do={
            /ppp secret disable $sec
            :local act [/ppp active find name=$nom]
            :if ([:len $act] > 0) do={ /ppp active remove $act }
          } else={
            :log info ("APESPOT PPPoE (TEST): couperait " . $nom)
          }
          :set nbCoupe ($nbCoupe + 1)
        }
        :if ($action = "E") do={
          :if ($appliquer) do={
            /ppp secret enable $sec
          } else={
            :log info ("APESPOT PPPoE (TEST): activerait " . $nom)
          }
          :set nbActive ($nbActive + 1)
        }
        :if ($action = "X") do={
          :if ($supprimer) do={
            :local act [/ppp active find name=$nom]
            :if ([:len $act] > 0) do={ /ppp active remove $act }
            /ppp secret remove $sec
          } else={
            :log warning ("APESPOT PPPoE (TEST SUPPR): supprimerait " . $nom)
          }
          :set nbSuppr ($nbSuppr + 1)
        }
      }
    }
    :set line ""
  } else={
    :set line ($line . $ch)
  }
}

# 5) Resume dans Log (les lignes "(TEST)" ci-dessus disent ce qui est simule).
:log info ("APESPOT PPPoE " . $serveur . " ok. coupe=" . $nbCoupe . " actif=" . $nbActive . " suppr=" . $nbSuppr)
