@echo off
title GuiaIA V1 - Consola del Agente
chcp 65001 >nul
cls

echo ============================================================
echo           INICIANDO GUIAIA V1 - AGENTE MINECRAFT
echo ============================================================
echo.

where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js no está instalado o no está en el PATH.
    echo Por favor, instala Node.js ^>= 22 desde https://nodejs.org/
    echo.
    pause
    exit /b 1
)

cd /d "%~dp0companion"
if not exist "node_modules" (
    echo [AVISO] Dependencias no encontradas. Ejecutando instalación inicial...
    call npm ci
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] Falló la instalación de dependencias.
        pause
        exit /b 1
    )
)

node src/cli_v1.js %*

if %ERRORLEVEL% neq 0 (
    echo.
    echo [AVISO] GuiaIA terminó con código de error: %ERRORLEVEL%
    pause
)
