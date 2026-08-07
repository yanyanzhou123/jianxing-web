@echo off
chcp 65001 >nul
cd /d "%~dp0"
title R2 一键备份
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0backup.ps1"
if errorlevel 1 exit /b 1
