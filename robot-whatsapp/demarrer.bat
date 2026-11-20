@echo off
REM Double-clique sur ce fichier pour demarrer le robot WhatsApp APESPOT.
cd /d "%~dp0"
echo ============================================
echo   ROBOT WHATSAPP APESPOT
echo ============================================
echo.
node robot.js
echo.
echo Le robot s'est arrete. Appuie sur une touche pour fermer.
pause >nul
