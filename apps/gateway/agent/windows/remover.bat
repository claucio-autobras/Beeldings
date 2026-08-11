@echo off
setlocal EnableExtensions
REM ===========================================================================
REM  Beeldings IoT Gateway - Remocao do Servico do Windows
REM  Execute como ADMINISTRADOR. Use antes de reinstalar do zero.
REM ===========================================================================

set "SERVICE_NAME=BeeldingsGateway"
set "LEGACY_SERVICE_NAME=BlueBeeGateway"
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

REM --- Limpa tambem o servico LEGADO (nome antigo BlueBee), se existir ------
sc.exe query %LEGACY_SERVICE_NAME% >nul 2>&1
if %errorlevel% equ 0 (
  echo Removendo tambem o servico legado "%LEGACY_SERVICE_NAME%"...
  if exist "%NSSM%" (
    "%NSSM%" stop %LEGACY_SERVICE_NAME% >nul 2>&1
    "%NSSM%" remove %LEGACY_SERVICE_NAME% confirm >nul 2>&1
  )
  sc.exe stop %LEGACY_SERVICE_NAME% >nul 2>&1
  sc.exe delete %LEGACY_SERVICE_NAME% >nul 2>&1
)

echo.
echo Conferindo (deve dizer que o servico nao existe mais):
sc.exe query %SERVICE_NAME%

echo.
echo Servico removido. Para reinstalar, rode o instalar.bat como administrador.
pause
endlocal
