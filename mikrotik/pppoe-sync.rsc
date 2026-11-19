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
# ===========================================================================

# ---- A MODIFIER SUR CHAQUE ROUTEUR ----------------------------------------
:local serveur "V6"
# ^ le nom du serveur de CE routeur : V6, V11, V12 ou H2

:local token "METS-ICI-TON-SECRET"
# ^ exactement la meme valeur que la variable PPPOE_SYNC_SECRET sur Vercel

:local appliquer false
# ^ false = TEST (ecrit seulement dans Log, ne coupe/active personne)
#   true  = applique vraiment les coupures et les activations
# ---------------------------------------------------------------------------

:local base "https://apespot-wifi.vercel.app/api/pppoe-sync"
:local fichier "apespot-pppoe.txt"

# Phase 3 : on remonte la liste des comptes ACTIFS de ce routeur, pour que le
# site cree automatiquement ceux qui manquent (SANS date : l'admin la mettra).
# Uniquement en mode reel (appliquer=true) : en mode test, rien n'est envoye,
# donc rien n'est cree cote site.
:local comptes ""
:if ($appliquer) do={
  :foreach s in=[/ppp secret find where disabled=no] do={
    :local nm [/ppp secret get $s name]
    # On n'envoie que les noms simples (sans espace), pour ne pas casser l'URL.
    :if ([:typeof [:find $nm " "]] = "nil") do={
      :set comptes ($comptes . $nm . ",")
    }
  }
}

:local url ($base . "\?serveur=" . $serveur . "&token=" . $token . "&comptes=" . $comptes)

# 1) Telecharger la liste depuis APESPOT.
:do {
  /tool fetch url=$url mode=https check-certificate=no dst-path=$fichier
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
      }
    }
    :set line ""
  } else={
    :set line ($line . $ch)
  }
}

# 5) Resume dans Log.
:if ($appliquer) do={
  :log info ("APESPOT PPPoE: " . $serveur . " ok. Coupes=" . $nbCoupe . " Actifs=" . $nbActive)
} else={
  :log info ("APESPOT PPPoE (MODE TEST): " . $serveur . " ok. Couperait=" . $nbCoupe . " Activerait=" . $nbActive)
}
