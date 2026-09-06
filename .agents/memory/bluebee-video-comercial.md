---
name: Vídeo comercial (video-js)
description: Lições do artefato de vídeo narrado — TTS, mix de áudio e sincronização por cena
---

- TTS (ElevenLabs via callback) retorna 500 intermitente: sempre gerar com loop de retry (3x, backoff ~3s); a mesma chamada que falhou funciona no retry.
- Única voz pt-BR encontrada no catálogo: ScheilaSMTy (`cyD08lEy76q03ER1jZ7y`); buscas por "portuguese" retornam vozes pt-PT.
- **Regra:** medir a duração real de cada VO (ffprobe) e retunar `SCENE_DURATIONS` para caber narração + 250ms de delay + folga ≥400ms, ANTES de mixar o composite — o composite congela os offsets cumulativos.
- **Why:** o `<audio>` único faz seek por offset canônico da cena; se a cena for menor que a fala, a locução é cortada no seek da próxima cena.
- **How to apply:** qualquer mudança em durações de cena exige regerar `composite_audio.mp3` (ffmpeg adelay cumulativo, música ~0.22, amix normalize=0, `-t` total) em lockstep.
- **Regra de texto em tela:** medir também os timestamps de início de cada frase na VO final; fases internas e descritivos devem usar esses tempos, não divisões aproximadas da duração total.
- **Why:** durações corretas por cena não garantem sincronia dentro da cena; na sequência da IA, perguntas e respostas chegaram a entrar 2–5s antes da fala.
- **How to apply:** transcrever a faixa final com timestamps, alinhar cada `setPhase` ao início da frase correspondente e validar uma grade de quadros extraídos desses pontos no MP4.
- Artefato roda em monorepo npm (não pnpm): dependências `catalog:` do template precisam ser pinadas manualmente no package.json.
- Export MP4: não há callback de plataforma p/ video-js; pipeline própria em `artifacts/video-comercial/scripts/export-mp4.sh` + `export-capture.js` (Xvfb + chromium kiosk via playwright-core + ffmpeg x11grab wallclock; trim = startRecording epoch − primeiro PTS; mux composite via ffmpeg).
- **Gotchas do export:** processos bg morrem com a sessão bash → spawnar do sandbox code_execution (persistente); sandbox PATH sem nix tools → caminhos absolutos; addInitScript não pode tocar documentElement antes de definir startRecording (throw silencia o hook); `--lang=pt-BR` sozinho NÃO remove o popup de tradução — limpar o profile, gravar `translate.enabled=false`, usar `--disable-translate` e fechar overlays antes da captura; cursor X some com xdotool mousemove 1919 1079 antes do goto; body branco pré-React → pintar #020617 no DOMContentLoaded.
- configureWorkflow quebrado neste env (rg em skills inexistentes) — não usar p/ processos longos.
- Versões sociais (1:1/9:16) derivadas do MP4 16:9 via ffmpeg blur-pad (bg = scale+crop+gblur+eq escuro, fg centrado), sem recapturar; encode 9:16 estoura o timeout de 120s do bash → rodar detached e NUNCA deixar dois ffmpeg escrevendo o mesmo arquivo (corrompe NAL units).

## Export determinístico (relógio virtual)
- Captura em tempo real (x11grab) dessincroniza sob carga: 2 vCPUs fazem o pass rodar 30-40% mais lento que o wall-clock → áudio fora de sincronia. Não confiável.
- Solução: scripts/export-deterministic.{sh,js} — Playwright headless com Date.now/performance.now/rAF/setTimeout/setInterval virtualizados; step de 1/FPS por frame + page.screenshot JPEG → ffmpeg image2pipe. Sincronia perfeita independente de CPU.
- **Gotchas:** blur(100-120px) dos círculos de fundo torna o screenshot ~30x mais lento → CSS injetado troca por mask radial (visual quase igual, custo ~zero); renderer do Chromium morre por OOM se <1GB livre (matar tsserver ajuda: ~1,7GB); pkill -f com padrão que aparece no próprio comando bash mata o shell (usar colchete: `detcap[.]js`); processos bg do bash tool morrem com o shell mesmo com setsid — lançar via spawn detached no code_execution apontando para UM script wrapper; env do detached é mínimo (python3 não está no PATH — usar caminhos nix completos); /tmp pode ser limpo entre comandos — persistir scripts no repo, não só em /tmp.
- Build para captura usa BASE_PATH=/ servido em http.server 4173; restaurar build com BASE_PATH=/video-comercial/ depois.

## Direção narrativa aprovada
- **Regra:** a versão institucional longa usa o roteiro integral (~3m30), preserva a voz feminina ScheilaSMTy e menciona redução de custo apenas como consequência sutil de eficiência e previsibilidade.
- **Regra de marca:** a grafia visual é sempre “Beeldings”, mas toda locução pt-BR deve pronunciar a marca como “Bildings”; usar essa forma fonética somente no texto enviado ao TTS.
- **Why:** o usuário escolheu priorizar o roteiro completo e uma cadência cinematográfica, corrigiu explicitamente a pronúncia brasileira e rejeitou transformar redução de custo em promessa central.
- **How to apply:** futuras revisões devem manter essa hierarquia, desacelerar especialmente a entrada da BlueBee e nunca expor “Bildings” visualmente; mudanças exigem novo alinhamento.

## Sincronização com o aplicativo
- **Regra:** toda cena que representa uma tela do BlueBee deve usar captura autenticada da rota atual no momento da exportação; screenshots históricos não são fonte confiável após uma refatoração.
- **Why:** o comercial precisa mostrar o produto que existe hoje, sem login acidental, layouts obsoletos ou telas que contradigam a demonstração.
- **How to apply:** capturar as rotas administrativas com sessão real, revisar uma grade dos quadros e só então executar a exportação final; a cena de IA pode continuar sendo uma composição animada quando isso for necessário para a narrativa.
