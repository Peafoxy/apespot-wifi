@echo off
REM Lanceur du robot WhatsApp APESPOT.
REM Se relance tout seul si le robot s'arrete (plantage, coupure reseau...).
cd /d "%~dp0"
:loop
echo ============================================
echo   ROBOT WHATSAPP APESPOT
echo ============================================
echo.
node robot.js
echo.
echo Le robot s'est arrete. Redemarrage automatique dans 5 secondes...
echo (Ferme cette fenetre pour l'arreter completement.)
timeout /t 5 /nobreak >nul
goto loop
