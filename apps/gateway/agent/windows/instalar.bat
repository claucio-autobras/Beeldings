@echo off
setlocal EnableExtensions
REM ===========================================================================
REM  BlueBee IoT Gateway - Instalacao (npm + Servico do Windows via NSSM)
REM  Execute como ADMINISTRADOR (botao direito > Executar como administrador).
REM  Coloque o gateway-config.env (ou .env) nesta mesma pasta antes de rodar.
REM ===========================================================================

set "SERVICE_NAME=BlueBeeGateway"
set "DISPLAY_NAME=BlueBee IoT Gateway"
set "DIR=%~dp0"
set "APPDIR=%DIR%"
if "%APPDIR:~-1%"=="\" set "APPDIR=%APPDIR:~0,-1%"
set "NSSM=%DIR%nssm.exe"
set "LOG=%DIR%gateway.log"

REM Garante que npm install/build rodem na pasta do script, mesmo que o .bat
REM seja chamado a partir de outro diretorio.
cd /d "%DIR%"

REM --- Privilegios de administrador ---------------------------------------
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo [ERRO] Este script precisa ser executado como Administrador.
  echo        Clique com o botao direito e escolha "Executar como administrador".
  pause
  exit /b 1
)

REM --- Localiza o Node.js --------------------------------------------------
set "NODE="
for /f "delims=" %%i in ('where node 2^>nul') do (
  if not defined NODE set "NODE=%%i"
)
if not defined NODE (
  echo [ERRO] Node.js nao encontrado no PATH.
  echo        Instale o Node.js 20+ de https://nodejs.org e tente novamente.
  pause
  exit /b 1
)
echo Node encontrado: %NODE%

if not exist "%NSSM%" (
  echo [ERRO] nssm.exe nao encontrado em "%DIR%".
  pause
  exit /b 1
)

REM --- Configuracao (.env) -------------------------------------------------
if not exist "%DIR%.env" (
  if exist "%DIR%gateway-config.env" (
    copy /Y "%DIR%gateway-config.env" "%DIR%.env" >nul
    echo gateway-config.env copiado para .env
  ) else (
    echo [AVISO] .env nao encontrado. Coloque o gateway-config.env nesta pasta.
    echo         O servico sera instalado, mas so conecta apos o .env existir.
    echo.
  )
)

REM --- Dependencias e build ------------------------------------------------
echo.
echo Instalando dependencias (npm install)... pode levar alguns minutos.
call npm install
if %errorlevel% neq 0 (
  echo [ERRO] npm install falhou.
  pause
  exit /b 1
)

echo Compilando o gateway (npm run build)...
call npm run build
if %errorlevel% neq 0 (
  echo [ERRO] npm run build falhou.
  pause
  exit /b 1
)

if not exist "%DIR%dist\main.js" (
  echo [ERRO] dist\main.js nao foi gerado pelo build.
  pause
  exit /b 1
)

if not exist "%DIR%run.js" (
  echo [ERRO] run.js ^(launcher OTA^) nao encontrado no pacote.
  pause
  exit /b 1
)

REM --- Remove instalacao anterior, se existir ------------------------------
"%NSSM%" status %SERVICE_NAME% >nul 2>&1
if %errorlevel% equ 0 (
  echo Removendo instalacao anterior do servico...
  "%NSSM%" stop %SERVICE_NAME% >nul 2>&1
  "%NSSM%" remove %SERVICE_NAME% confirm >nul 2>&1
)

REM --- Instala e configura o servico (Node executando o launcher OTA) ------
echo Instalando servico "%SERVICE_NAME%"...
"%NSSM%" install %SERVICE_NAME% "%NODE%" "run.js"
if %errorlevel% neq 0 (
  echo [ERRO] Falha ao instalar o servico.
  pause
  exit /b 1
)

"%NSSM%" set %SERVICE_NAME% AppDirectory "%APPDIR%"
"%NSSM%" set %SERVICE_NAME% DisplayName "%DISPLAY_NAME%"
"%NSSM%" set %SERVICE_NAME% Description "Gateway local BlueBee IoT (BACnet/Modbus para MQTT)."
"%NSSM%" set %SERVICE_NAME% Start SERVICE_AUTO_START
"%NSSM%" set %SERVICE_NAME% AppStdout "%LOG%"
"%NSSM%" set %SERVICE_NAME% AppStderr "%LOG%"
"%NSSM%" set %SERVICE_NAME% AppRotateFiles 1
"%NSSM%" set %SERVICE_NAME% AppRotateOnline 1
"%NSSM%" set %SERVICE_NAME% AppRotateBytes 10485760
"%NSSM%" set %SERVICE_NAME% AppExit Default Restart
"%NSSM%" set %SERVICE_NAME% AppRestartDelay 5000

echo Iniciando servico...
"%NSSM%" start %SERVICE_NAME%

echo.
echo ===========================================================================
echo  Servico "%DISPLAY_NAME%" instalado e iniciado.
echo  - Gerencie em: services.msc  (procure por "%DISPLAY_NAME%")
echo  - Status:      sc query %SERVICE_NAME%
echo  - Logs em:     %LOG%
echo ===========================================================================
pause
endlocal
