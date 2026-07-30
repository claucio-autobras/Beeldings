@echo off
setlocal EnableExtensions
REM ===========================================================================
REM  BlueBee IoT Gateway - Remocao do Servico do Windows
REM  Execute como ADMINISTRADOR. Use antes de reinstalar do zero.
REM ===========================================================================

set "SERVICE_NAME=BlueBeeGateway"
set "NSSM=%~dp0nssm.exe"

REM --- Privilegios de administrador ---------------------------------------
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo [ERRO] Este script precisa ser executado como Administrador.
  pause
  exit /b 1
)

echo Parando e removendo o servico "%SERVICE_NAME%"...

if exist "%NSSM%" (
  "%NSSM%" stop %SERVICE_NAME% >nul 2>&1
  "%NSSM%" remove %SERVICE_NAME% confirm
) else (
  REM Reserva, sem NSSM: comandos nativos do Windows
  sc.exe stop %SERVICE_NAME% >nul 2>&1
  sc.exe delete %SERVICE_NAME%
)

echo.
echo Conferindo (deve dizer que o servico nao existe mais):
sc.exe query %SERVICE_NAME%

echo.
echo Servico removido. Para reinstalar, rode o instalar.bat como administrador.
pause
endlocal
