/**
 * Regressão do contrato de disponibilidade de vídeo no card CFTV.
 *
 * O protocolo de monitoramento (SNMP/ONVIF) não define sozinho se existe um
 * canal de vídeo. A resposta deve reconhecer o canal ONVIF/RTSP opcional de
 * uma câmera SNMP e não anunciar uma fonte inexistente para câmeras ONVIF.
 */

import { CftvController } from './cftv.controller.js';

function fakeCamera(
  protocol: 'snmp' | 'onvif',
  config: Record<string, unknown>,
) {
  return {
    id: `cam-${protocol}`,
    name: 'Câmera teste',
    protocol,
    ip: '10.0.0.10',
    port: protocol === 'snmp' ? 161 : 80,
    tenantId: 'tenant-1',
    siteId: null,
    gatewayId: 'gw-1',
    config,
    points: [],
    site: null,
  };
}

function buildController() {
  const prisma = {} as never;
  const deviceStatus = {
    getStatus: jest.fn().mockReturnValue('online'),
  };

  return new CftvController(
    prisma,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    deviceStatus as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

function mapCamera(
  controller: CftvController,
  camera: ReturnType<typeof fakeCamera>,
) {
  return (
    controller as unknown as {
      mapCamera: (
        value: ReturnType<typeof fakeCamera>,
        lastCommunication: string | null,
      ) => {
        liveViewAvailable: boolean;
      };
    }
  ).mapCamera(camera, null);
}

describe('CftvController — disponibilidade do vídeo ao vivo', () => {
  it('reconhece ONVIF/RTSP configurado em câmera monitorada por SNMP', () => {
    const controller = buildController();

    expect(
      mapCamera(
        controller,
        fakeCamera('snmp', {
          onvifUsername: 'admin',
          onvifPasswordEnc: 'enc:v1:configured',
        }),
      ).liveViewAvailable,
    ).toBe(true);
    expect(
      mapCamera(
        controller,
        fakeCamera('snmp', {
          rtspUrl: 'rtsp://10.0.0.10/stream',
        }),
      ).liveViewAvailable,
    ).toBe(true);
  });

  it('não anuncia vídeo quando a câmera ONVIF não tem fonte configurada', () => {
    expect(
      mapCamera(buildController(), fakeCamera('onvif', {})).liveViewAvailable,
    ).toBe(false);
  });

  it('não considera credencial incompleta uma fonte de vídeo', () => {
    const controller = buildController();

    expect(
      mapCamera(
        controller,
        fakeCamera('snmp', {
          onvifUsername: 'admin',
        }),
      ).liveViewAvailable,
    ).toBe(false);
    expect(
      mapCamera(
        controller,
        fakeCamera('snmp', {
          onvifPasswordEnc: 'enc:v1:configured',
        }),
      ).liveViewAvailable,
    ).toBe(false);
  });
});
