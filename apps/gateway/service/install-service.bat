@echo off
setlocal EnableExtensions
REM ===========================================================================
REM  BlueBee IoT Gateway - Instalacao como servico do Windows (via NSSM)
REM  Execute este arquivo como ADMINISTRADOR (botao direito > Executar como
REM  administrador). Os arquivos bluebee-gateway.exe, nssm.exe e .env devem
REM  estar na MESMA pasta que este script.
REM ===========================================================================

set "SERVICE_NAME=BlueBeeGateway"
set "DISPLAY_NAME=BlueBee IoT Gateway"
set "DIR=%~dp0"
REM AppDirectory nao pode terminar em "\" — a barra final faria o cmd escapar a
REM aspa de fechamento (\") e gravar um caminho invalido no servico.
set "APPDIR=%DIR%"
if "%APPDIR:~-1%"=="\" set "APPDIR=%APPDIR:~0,-1%"
set "EXE=%DIR%bluebee-gateway.exe"
set "NSSM=%DIR%nssm.exe"
set "LOG=%DIR%gateway.log"

REM --- Verifica privilegios de administrador -------------------------------
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo [ERRO] Este script precisa ser executado como Administrador.
  echo        Clique com o botao direito e escolha "Executar como administrador".
  pause
  exit /b 1
)

REM --- Verifica arquivos necessarios ---------------------------------------
if not exist "%EXE%" (
  echo [ERRO] bluebee-gateway.exe nao encontrado em "%DIR%".
  pause
  exit /b 1
)
if not exist "%NSSM%" (
  echo [ERRO] nssm.exe nao encontrado em "%DIR%".
  pause
  exit /b 1
)
if not exist "%DIR%.env" (
  echo [AVISO] Arquivo .env nao encontrado em "%DIR%".
  echo         Baixe o .env do gateway na plataforma BlueBee e coloque aqui.
  echo.
)

REM --- Remove instalacao anterior, se existir ------------------------------
"%NSSM%" status %SERVICE_NAME% >nul 2>&1
if %errorlevel% equ 0 (
  echo Removendo instalacao anterior do servico...
  "%NSSM%" stop %SERVICE_NAME% >nul 2>&1
  "%NSSM%" remove %SERVICE_NAME% confirm >nul 2>&1
)

REM --- Instala e configura o servico ---------------------------------------
echo Instalando servico "%SERVICE_NAME%"...
"%NSSM%" install %SERVICE_NAME% "%EXE%"
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
REM Reinicia automaticamente em caso de falha (espera 5s entre tentativas)
"%NSSM%" set %SERVICE_NAME% AppExit Default Restart
"%NSSM%" set %SERVICE_NAME% AppRestartDelay 5000

echo Iniciando servico...
"%NSSM%" start %SERVICE_NAME%

echo.
echo ===========================================================================
echo  Servico "%DISPLAY_NAME%" instalado e iniciado.
echo  - Gerencie em: services.msc  (procure por "%DISPLAY_NAME%")
echo  - Logs em:     %LOG%
echo ===========================================================================
pause
endlocal
