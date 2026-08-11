import { EventEmitter2 } from '@nestjs/event-emitter';
import { CommandDispatcherService } from './command-dispatcher.service';

/**
 * Dispatcher de onvif.live_start — validação de origem de vídeo.
 *
 * O live view não é exclusivo de câmeras ONVIF: câmera SNMP pode ter só a
 * URL RTSP como credencial de vídeo (modo RTSP-only, sem usuário ONVIF).
 * O dispatcher deve aceitar `ip + (username OU rtspUrl)`, alinhado com
 * OnvifLiveViewService.startSession.
 */
describe('CommandDispatcherService — onvif.live_start', () => {
  const topic = 'bluebee/tenant-1/gateway/gw-1/commands';

  function build() {
    const emitted: Array<{ event: string; payload: unknown }> = [];
    const eventEmitter = {
      emit: (event: string, payload: unknown) => {
        emitted.push({ event, payload });
        return true;
      },
    } as unknown as EventEmitter2;
    const service = new CommandDispatcherService(eventEmitter);
    return { service, emitted };
  }

  function liveStart(params: Record<string, unknown>) {
    return {
      command_id: 'cmd-1',
      tenant_id: 'tenant-1',
      device_id: 'dev-1',
      protocol: 'onvif',
      action: 'live_start',
      params: { sessionId: 'sess-1', ip: '192.168.0.50', port: 80, ...params },
    };
  }

  it('encaminha live_start com credenciais ONVIF (fluxo clássico)', () => {
    const { service, emitted } = build();
    service.handleMqttMessage({
      topic,
      message: liveStart({ username: 'admin', password: 's3cret', rtspUrl: null }),
    });
    expect(emitted).toHaveLength(1);
    expect(emitted[0].event).toBe('command.onvif.live_view');
    expect(emitted[0].payload).toMatchObject({
      session_id: 'sess-1',
      username: 'admin',
      rtspUrl: null,
    });
  });

  it('encaminha live_start RTSP-only (sem usuário ONVIF, com rtspUrl)', () => {
    const { service, emitted } = build();
    service.handleMqttMessage({
      topic,
      message: liveStart({
        username: '',
        password: '',
        rtspUrl: 'rtsp://192.168.0.50:554/stream',
      }),
    });
    expect(emitted).toHaveLength(1);
    expect(emitted[0].event).toBe('command.onvif.live_view');
    expect(emitted[0].payload).toMatchObject({
      session_id: 'sess-1',
      username: '',
      rtspUrl: 'rtsp://192.168.0.50:554/stream',
    });
  });

  it('descarta live_start sem usuário E sem rtspUrl', () => {
    const { service, emitted } = build();
    service.handleMqttMessage({
      topic,
      message: liveStart({ username: '', password: '', rtspUrl: null }),
    });
    expect(emitted).toHaveLength(0);
  });

  it('descarta live_start sem IP', () => {
    const { service, emitted } = build();
    service.handleMqttMessage({
      topic,
      message: liveStart({ ip: '', username: 'admin', password: 'x' }),
    });
    expect(emitted).toHaveLength(0);
  });
});
