@echo off
REM ====================================================================
REM  Installe le DEMARRAGE AUTOMATIQUE du robot APESPOT.
REM  Double-clique sur ce fichier UNE SEULE FOIS.
REM ====================================================================
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$w=New-Object -ComObject WScript.Shell; $l=$w.CreateShortcut([Environment]::GetFolderPath('Startup')+'\Robot APESPOT.lnk'); $l.TargetPath='%~dp0demarrer.bat'; $l.WorkingDirectory='%~dp0'; $l.Description='Robot WhatsApp APESPOT'; $l.Save(); Write-Host 'Raccourci cree avec succes.'"

echo.
echo ================================================================
echo   Si la ligne "Raccourci cree avec succes." s'affiche juste
echo   au-dessus, c'est bon : le robot demarrera tout seul a chaque
echo   demarrage de Windows (ouverture de session).
echo.
echo   S'il y a des lignes en ROUGE, dis-le a l'administrateur.
echo.
echo   Pour un redemarrage SANS connexion manuelle : active
echo   l'ouverture de session auto (Windows + R, tape : netplwiz).
echo.
echo   Pour ANNULER le demarrage auto : Windows + R, tape
echo   shell:startup, puis supprime le raccourci "Robot APESPOT".
echo ================================================================
echo.
pause
