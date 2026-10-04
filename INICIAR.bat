@echo off
rem T-VOTE: dois cliques aqui instalam (se preciso) e abrem o sistema no navegador.
rem Todo o trabalho fica em scripts\iniciar.ps1.
title T-VOTE
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\iniciar.ps1" %*
if errorlevel 1 pause
