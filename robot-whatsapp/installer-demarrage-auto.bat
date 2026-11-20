@echo off
REM ====================================================================
REM  Installe le DEMARRAGE AUTOMATIQUE du robot APESPOT.
REM  Double-clique sur ce fichier UNE SEULE FOIS.
REM  Apres ca, le robot se lancera tout seul a chaque ouverture de
REM  session Windows (donc a chaque redemarrage de l'ordinateur).
REM ====================================================================
cd /d "%~dp0"
set "CIBLE=%~dp0demarrer.bat"
set "DOSSIER=%~dp0"
set "DEMARRAGE=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$w = New-Object -ComObject WScript.Shell;" ^
  "$lnk = $w.CreateShortcut(Join-Path '%DEMARRAGE%' 'Robot APESPOT.lnk');" ^
  "$lnk.TargetPath = '%CIBLE%';" ^
  "$lnk.WorkingDirectory = '%DOSSIER%';" ^
  "$lnk.Description = 'Robot WhatsApp APESPOT';" ^
  "$lnk.Save()"

echo.
echo ====================================================================
echo   OK ! Le robot demarrera AUTOMATIQUEMENT a chaque demarrage
echo   de Windows (ouverture de session).
echo.
echo   Pour que cela marche apres un redemarrage SANS que personne ne
echo   se connecte, active l'ouverture de session automatique de Windows
echo   (commande : netplwiz).
echo.
echo   Pour ANNULER le demarrage auto : supprime le raccourci
echo   "Robot APESPOT" dans le dossier Demarrage (touche Windows + R,
echo   tape  shell:startup  puis Entree).
echo ====================================================================
echo.
pause
