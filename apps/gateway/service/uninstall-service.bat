@echo off
setlocal EnableExtensions
REM ===========================================================================
REM  BlueBee IoT Gateway - Desinstalacao do servico do Windows (via NSSM)
REM  Execute como ADMINISTRADOR.
REM ===========================================================================

set "SERVICE_NAME=BlueBeeGateway"
set "NSSM=%~dp0nssm.exe"

REM --- Verifica privilegios de administrador -------------------------------
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo [ERRO] Este script precisa ser executado como Administrador.
  pause
  exit /b 1
)

if not exist "%NSSM%" (
  echo [ERRO] nssm.exe nao encontrado nesta pasta.
  pause
  exit /b 1
)

"%NSSM%" status %SERVICE_NAME% >nul 2>&1
if %errorlevel% neq 0 (
  echo O servico "%SERVICE_NAME%" nao esta instalado.
  pause
  exit /b 0
)

echo Parando o servico "%SERVICE_NAME%"...
"%NSSM%" stop %SERVICE_NAME% >nul 2>&1

echo Removendo o servico "%SERVICE_NAME%"...
"%NSSM%" remove %SERVICE_NAME% confirm

echo.
echo Servico removido com sucesso.
pause
endlocal
