---
name: Vídeo comercial (video-js)
description: Lições do artefato de vídeo narrado — TTS, mix de áudio e sincronização por cena
---

- TTS (ElevenLabs via callback) retorna 500 intermitente: sempre gerar com loop de retry (3x, backoff ~3s); a mesma chamada que falhou funciona no retry.
- Única voz pt-BR encontrada no catálogo: ScheilaSMTy (`cyD08lEy76q03ER1jZ7y`); buscas por "portuguese" retornam vozes pt-PT.
- **Regra:** medir a duração real de cada VO (ffprobe) e retunar `SCENE_DURATIONS` para caber narração + 250ms de delay + folga ≥400ms, ANTES de mixar o composite — o composite congela os offsets cumulativos.
- **Why:** o `<audio>` único faz seek por offset canônico da cena; se a cena for menor que a fala, a locução é cortada no seek da próxima cena.
- **How to apply:** qualquer mudança em durações de cena exige regerar `composite_audio.mp3` (ffmpeg adelay cumulativo, música ~0.22, amix normalize=0, `-t` total) em lockstep.
- Artefato roda em monorepo npm (não pnpm): dependências `catalog:` do template precisam ser pinadas manualmente no package.json.
- Export MP4: não há callback de plataforma p/ video-js; pipeline própria em `artifacts/video-comercial/scripts/export-mp4.sh` + `export-capture.js` (Xvfb + chromium kiosk via playwright-core + ffmpeg x11grab wallclock; trim = startRecording epoch − primeiro PTS; mux composite via ffmpeg).
- **Gotchas do export:** processos bg morrem com a sessão bash → spawnar do sandbox code_execution (persistente); sandbox PATH sem nix tools → caminhos absolutos; addInitScript não pode tocar documentElement antes de definir startRecording (throw silencia o hook); translate bubble some com --lang=pt-BR; cursor X some com xdotool mousemove 1919 1079 antes do goto; body branco pré-React → pintar #020617 no DOMContentLoaded.
- configureWorkflow quebrado neste env (rg em skills inexistentes) — não usar p/ processos longos.
- Versões sociais (1:1/9:16) derivadas do MP4 16:9 via ffmpeg blur-pad (bg = scale+crop+gblur+eq escuro, fg centrado), sem recapturar; encode 9:16 estoura o timeout de 120s do bash → rodar detached e NUNCA deixar dois ffmpeg escrevendo o mesmo arquivo (corrompe NAL units).

## Export determinístico (relógio virtual)
- Captura em tempo real (x11grab) dessincroniza sob carga: 2 vCPUs fazem o pass rodar 30-40% mais lento que o wall-clock → áudio fora de sincronia. Não confiável.
- Solução: scripts/export-deterministic.{sh,js} — Playwright headless com Date.now/performance.now/rAF/setTimeout/setInterval virtualizados; step de 1/FPS por frame + page.screenshot JPEG → ffmpeg image2pipe. Sincronia perfeita independente de CPU.
- **Gotchas:** blur(100-120px) dos círculos de fundo torna o screenshot ~30x mais lento → CSS injetado troca por mask radial (visual quase igual, custo ~zero); renderer do Chromium morre por OOM se <1GB livre (matar tsserver ajuda: ~1,7GB); pkill -f com padrão que aparece no próprio comando bash mata o shell (usar colchete: `detcap[.]js`); processos bg do bash tool morrem com o shell mesmo com setsid — lançar via spawn detached no code_execution apontando para UM script wrapper; env do detached é mínimo (python3 não está no PATH — usar caminhos nix completos); /tmp pode ser limpo entre comandos — persistir scripts no repo, não só em /tmp.
- Build para captura usa BASE_PATH=/ servido em http.server 4173; restaurar build com BASE_PATH=/video-comercial/ depois.
