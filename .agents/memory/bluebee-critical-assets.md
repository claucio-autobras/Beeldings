---
name: Critical assets card
description: Regras do card Ativos Críticos do dashboard e do endpoint /dashboard/critical-assets
---

- Criticidade = flag `is_critical` em `devices` e `device_points` (toggle via PATCH existentes de device/ponto; câmera reusa PATCH /devices/:id porque câmera é Device).
- **Runtime só de ponto opRole='status' com trend** (prev-sample + janela, valor ≥0.5 = ligado); sem trend/amostras → `runtimeMs: null`, nunca 0 fake.
- Status de câmera no card: ponto STATUS manda, mas só se o device (canal de monitoramento) estiver vivo — device offline vence STATUS.
- `offlineSince` só quando status atual offline E último status_event foi 'offline'; senão null ("sem dados").
- Pontos de câmera também podem ser críticos (estrela por ponto no modal de telemetria CFTV, mesmo PATCH de ponto); estado do ponto usa o canal da câmera (resolveDeviceStatus, não getStatus cru).
- Deep-link de ponto de câmera → /cftv (o card resolve deviceId→câmera via cache do useCameras, sem mudar o shape do payload).
- Deep-link: falha → /alarms?state=open&highlight=<eventId>; câmera → /cftv; cliente com tela SCADA ativa contendo o deviceId (busca textual no JSON widgets) → /scada/view/<id>; senão /devices. Perfil técnico = ADMIN/CCO/SUPERVISOR.
- **Why:** payload autodescritivo (ms + ISO) é a fonte para a IA de manutenção preditiva (task futura) — mudanças de shape quebram consumidores.
- **How to apply:** novos tipos de ativo crítico entram no CriticalAssetsService mantendo o shape e as regras null-sem-dados.
- Toggle otimista no frontend: setQueriesData + invalidate ['devices'] (refetch em voo pode sobrescrever cache com estado antigo).
- Card mostra TODO estrelado, com `state` consolidado (aditivo): fault > no_response > running > stopped > unknown — nada some mais; ordenação por esse rank.
- Papel opRole='fault': valor ativo (≥0.5) COM device online = "Em falha" mesmo sem regra de alarme (faultSource='fault_point', faultRuleName = nome do ponto, faultAlarmEventId null); duração pela última transição off→on da trend do ponto (mesma lógica do activeSince); valor stale de device offline NÃO confirma falha (vira no_response).
- activeSince = última transição off→on na trend do ponto status; stoppedSince = última on→off; sem trend/amostras = null (item aparece com "Sem dados", nunca 0 fake). Campos aditivos: state/pointRole/faultSource/stoppedSince/stoppedMs.
- Câmeras não têm statusPoint no builder → aparecem como fault/no_response/unknown.
- opRole aceito no PATCH de ponto: status | fault | mode | setpoint | null (validação no devices.controller); dropdown do PointConfigPanel tem descrição curta por papel.
- Estrela de criticidade é EXCLUSIVA do perfil técnico (ADMIN/CCO/SUPERVISOR): UI esconde o controle para cliente E o backend rejeita (assertCanEditCriticality em devices.controller, cobre `critical` e `opRole`). Nova superfície com estrela = gatear UI + reutilizar o guard.
- Clique por perfil (helper puro criticalAssetClick.ts, testado): falha → FirstActionModal (ambos); técnico → /devices?deviceId&pointId com highlight/scroll do ponto (câmera → /cftv); cliente → CriticalAssetInfoModal com atalho contextual — NUNCA SCADA em no_response (ponto mudo lá).
- Fallback durável de estado/duração: pontos BMS não persistem lastValue → valor vigente vem da última amostra da trend; ponto tag STATUS de câmera (sem opRole) é tratado como status e usa status_events online/offline como since — SÓ no canal de câmera (em BMS status_event = comunicação, não run state).
- Modal de telemetria CFTV deve receber a câmera FRESCA da lista (cameras.find por id), não o snapshot do estado — senão a estrela do ponto fica stale pós-toggle.
