@echo off
title Servidor Web Ingelab - Confirmacion de Asistencia
color 0A
echo ==============================================================
echo       INICIANDO SISTEMA DE ASISTENCIA - INGELAB 2026
echo ==============================================================
echo.
echo  Abriendo servidor web local y base de datos SQLite...
echo.
start http://localhost:3000
node local_server.js
pause
