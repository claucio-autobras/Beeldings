#!/usr/bin/env node
/**
 * Simulador de câmera ONVIF para testes locais do gateway (sem hardware).
 *
 * Implementa o subconjunto SOAP que a lib `onvif` (npm) usa no fluxo do
 * gateway BlueBee:
 *   - GetSystemDateAndTime (não autenticado)
 *   - GetServices → fault (força o fallback GetCapabilities, caminho Profile S)
 *   - GetCapabilities (XAddrs de media/events apontando para este servidor)
 *   - GetDeviceInformation (valida o Username do WS-Security)
 *   - Media: GetProfiles / GetVideoSources / GetStreamUri
 *   - Events: CreatePullPointSubscription / PullMessages (long-poll) /
 *     Renew / Unsubscribe
 *
 * Controle (HTTP simples, fora do SOAP):
 *   GET /sim/motion?value=1  → injeta evento de movimento (0 = fim do movimento)
 *   GET /sim/health          → estado do simulador
 *
 * Uso: node scripts/dev-camera-onvif-sim.cjs [porta=8899] [usuario=admin]
 */

const http = require('http');

const PORT = Number(process.argv[2] || 8899);
const USERNAME = process.argv[3] || 'admin';
const HOST = '127.0.0.1';
const BASE = `http://${HOST}:${PORT}`;

// ---- estado do pull-point -------------------------------------------------
let pendingNotifications = [];
let waitingPull = null; // { res, timer }
let pullCount = 0;
let subCount = 0;

function isoIn(ms) {
  return new Date(Date.now() + ms).toISOString();
}

function soap(body) {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://www.w3.org/2003/05/soap-envelope" ' +
    'xmlns:tds="http://www.onvif.org/ver10/device/wsdl" ' +
    'xmlns:trt="http://www.onvif.org/ver10/media/wsdl" ' +
    'xmlns:tev="http://www.onvif.org/ver10/events/wsdl" ' +
    'xmlns:wsnt="http://docs.oasis-open.org/wsn/b-2" ' +
    'xmlns:wsa="http://www.w3.org/2005/08/addressing" ' +
    'xmlns:tns1="http://www.onvif.org/ver10/topics" ' +
    'xmlns:tt="http://www.onvif.org/ver10/schema">' +
    `<SOAP-ENV:Body>${body}</SOAP-ENV:Body></SOAP-ENV:Envelope>`
  );
}

function fault(reason) {
  return soap(
    '<SOAP-ENV:Fault><SOAP-ENV:Code><SOAP-ENV:Value>SOAP-ENV:Sender</SOAP-ENV:Value></SOAP-ENV:Code>' +
      `<SOAP-ENV:Reason><SOAP-ENV:Text xml:lang="en">${reason}</SOAP-ENV:Text></SOAP-ENV:Reason></SOAP-ENV:Fault>`,
  );
}

function reply(res, xml, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/soap+xml; charset=utf-8' });
  res.end(xml);
}

// ---- respostas SOAP ---------------------------------------------------------
function dateTimeResponse() {
  const now = new Date();
  return soap(
    '<tds:GetSystemDateAndTimeResponse><tds:SystemDateAndTime>' +
      '<tt:DateTimeType>NTP</tt:DateTimeType><tt:DaylightSavings>false</tt:DaylightSavings>' +
      '<tt:TimeZone><tt:TZ>UTC</tt:TZ></tt:TimeZone>' +
      '<tt:UTCDateTime>' +
      `<tt:Time><tt:Hour>${now.getUTCHours()}</tt:Hour><tt:Minute>${now.getUTCMinutes()}</tt:Minute><tt:Second>${now.getUTCSeconds()}</tt:Second></tt:Time>` +
      `<tt:Date><tt:Year>${now.getUTCFullYear()}</tt:Year><tt:Month>${now.getUTCMonth() + 1}</tt:Month><tt:Day>${now.getUTCDate()}</tt:Day></tt:Date>` +
      '</tt:UTCDateTime></tds:SystemDateAndTime></tds:GetSystemDateAndTimeResponse>',
  );
}

function capabilitiesResponse() {
  return soap(
    '<tds:GetCapabilitiesResponse><tds:Capabilities>' +
      `<tt:Device><tt:XAddr>${BASE}/onvif/device_service</tt:XAddr></tt:Device>` +
      `<tt:Events><tt:XAddr>${BASE}/onvif/events</tt:XAddr><tt:WSPullPointSupport>true</tt:WSPullPointSupport></tt:Events>` +
      `<tt:Media><tt:XAddr>${BASE}/onvif/media</tt:XAddr></tt:Media>` +
      '</tds:Capabilities></tds:GetCapabilitiesResponse>',
  );
}

function deviceInformationResponse() {
  return soap(
    '<tds:GetDeviceInformationResponse>' +
      '<tds:Manufacturer>BlueBee Sim</tds:Manufacturer><tds:Model>CAM-SIM-1000</tds:Model>' +
      '<tds:FirmwareVersion>1.0.0</tds:FirmwareVersion><tds:SerialNumber>SIM0001</tds:SerialNumber>' +
      '<tds:HardwareId>SIM</tds:HardwareId></tds:GetDeviceInformationResponse>',
  );
}

function profilesResponse() {
  return soap(
    '<trt:GetProfilesResponse><trt:Profiles token="Profile_1" fixed="true">' +
      '<tt:Name>MainStream</tt:Name>' +
      '<tt:VideoSourceConfiguration token="VideoSourceConfig_1">' +
      '<tt:Name>VSC1</tt:Name><tt:UseCount>1</tt:UseCount>' +
      '<tt:SourceToken>VideoSource_1</tt:SourceToken>' +
      '<tt:Bounds x="0" y="0" width="1920" height="1080"/></tt:VideoSourceConfiguration>' +
      '<tt:VideoEncoderConfiguration token="VideoEncoderConfig_1">' +
      '<tt:Name>VEC1</tt:Name><tt:UseCount>1</tt:UseCount><tt:Encoding>H264</tt:Encoding>' +
      '<tt:Resolution><tt:Width>1920</tt:Width><tt:Height>1080</tt:Height></tt:Resolution>' +
      '<tt:Quality>4</tt:Quality>' +
      '<tt:RateControl><tt:FrameRateLimit>30</tt:FrameRateLimit><tt:EncodingInterval>1</tt:EncodingInterval><tt:BitrateLimit>4096</tt:BitrateLimit></tt:RateControl>' +
      '</tt:VideoEncoderConfiguration>' +
      '</trt:Profiles></trt:GetProfilesResponse>',
  );
}

function videoSourcesResponse() {
  return soap(
    '<trt:GetVideoSourcesResponse><trt:VideoSources token="VideoSource_1">' +
      '<tt:Framerate>30</tt:Framerate>' +
      '<tt:Resolution><tt:Width>1920</tt:Width><tt:Height>1080</tt:Height></tt:Resolution>' +
      '</trt:VideoSources></trt:GetVideoSourcesResponse>',
  );
}

function streamUriResponse() {
  return soap(
    '<trt:GetStreamUriResponse><trt:MediaUri>' +
      `<tt:Uri>rtsp://${HOST}:8554/stream1</tt:Uri>` +
      '<tt:InvalidAfterConnect>false</tt:InvalidAfterConnect>' +
      '<tt:InvalidAfterReboot>false</tt:InvalidAfterReboot>' +
      '<tt:Timeout>PT60S</tt:Timeout>' +
      '</trt:MediaUri></trt:GetStreamUriResponse>',
  );
}

function subscriptionResponse() {
  subCount++;
  return soap(
    '<tev:CreatePullPointSubscriptionResponse>' +
      `<tev:SubscriptionReference><wsa:Address>${BASE}/onvif/events/sub</wsa:Address></tev:SubscriptionReference>` +
      `<wsnt:CurrentTime>${isoIn(0)}</wsnt:CurrentTime>` +
      `<wsnt:TerminationTime>${isoIn(600_000)}</wsnt:TerminationTime>` +
      '</tev:CreatePullPointSubscriptionResponse>',
  );
}

function notificationXml(n) {
  return (
    '<wsnt:NotificationMessage>' +
    `<wsnt:Topic Dialect="http://www.onvif.org/ver10/tev/topicExpression/ConcreteSet">${n.topic}</wsnt:Topic>` +
    '<wsnt:Message><tt:Message UtcTime="' + new Date().toISOString() + '" PropertyOperation="Changed">' +
    '<tt:Source><tt:SimpleItem Name="VideoSourceConfigurationToken" Value="VideoSourceConfig_1"/></tt:Source>' +
    `<tt:Data><tt:SimpleItem Name="${n.name}" Value="${n.value}"/></tt:Data>` +
    '</tt:Message></wsnt:Message></wsnt:NotificationMessage>'
  );
}

function pullMessagesResponse(notifications) {
  return soap(
    '<tev:PullMessagesResponse>' +
      `<tev:CurrentTime>${isoIn(0)}</tev:CurrentTime>` +
      `<tev:TerminationTime>${isoIn(600_000)}</tev:TerminationTime>` +
      notifications.map(notificationXml).join('') +
      '</tev:PullMessagesResponse>',
  );
}

function renewResponse() {
  return soap(
    '<wsnt:RenewResponse>' +
      `<wsnt:TerminationTime>${isoIn(600_000)}</wsnt:TerminationTime>` +
      `<wsnt:CurrentTime>${isoIn(0)}</wsnt:CurrentTime>` +
      '</wsnt:RenewResponse>',
  );
}

function flushPull() {
  if (waitingPull && pendingNotifications.length > 0) {
    const { res, timer } = waitingPull;
    clearTimeout(timer);
    waitingPull = null;
    const batch = pendingNotifications.splice(0, 10);
    reply(res, pullMessagesResponse(batch));
  }
}

function usernameFrom(xml) {
  const m = /<(?:[\w-]+:)?Username>([^<]*)</.exec(xml);
  return m ? m[1] : null;
}

// ---- servidor ---------------------------------------------------------------
const server = http.createServer((req, res) => {
  const url = req.url || '/';

  // Endpoints de controle do simulador
  if (url.startsWith('/sim/motion')) {
    const value = /value=0/.test(url) ? 'false' : 'true';
    pendingNotifications.push({
      topic: 'tns1:RuleEngine/CellMotionDetector/Motion',
      name: 'IsMotion',
      value,
    });
    flushPull();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, motion: value }));
    console.log(`[sim] motion=${value} injetado (pendentes=${pendingNotifications.length})`);
    return;
  }
  if (url.startsWith('/sim/tamper')) {
    const value = /value=0/.test(url) ? 'false' : 'true';
    pendingNotifications.push({
      topic: 'tns1:Device/Tamper',
      name: 'IsTamper',
      value,
    });
    flushPull();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, tamper: value }));
    return;
  }
  if (url.startsWith('/sim/health')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({ ok: true, subscriptions: subCount, pulls: pullCount, pending: pendingNotifications.length }),
    );
    return;
  }

  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const has = (op) => body.includes(op);

    if (has('GetSystemDateAndTime')) return reply(res, dateTimeResponse());
    if (has('GetServices')) return reply(res, fault('GetServices not supported'), 400);
    if (has('GetCapabilities')) return reply(res, capabilitiesResponse());

    if (has('GetDeviceInformation')) {
      const user = usernameFrom(body);
      if (user !== USERNAME) {
        console.log(`[sim] GetDeviceInformation NEGADO (user=${user})`);
        return reply(res, fault('Sender not Authorized'), 400);
      }
      return reply(res, deviceInformationResponse());
    }

    if (has('GetProfiles')) return reply(res, profilesResponse());
    if (has('GetVideoSources')) return reply(res, videoSourcesResponse());
    if (has('GetStreamUri')) return reply(res, streamUriResponse());

    if (has('CreatePullPointSubscription')) {
      console.log('[sim] pull-point subscription criada');
      return reply(res, subscriptionResponse());
    }
    if (has('PullMessages')) {
      pullCount++;
      console.log(`[sim] PullMessages #${pullCount} (pendentes=${pendingNotifications.length})`);
      if (pendingNotifications.length > 0) {
        const batch = pendingNotifications.splice(0, 10);
        return reply(res, pullMessagesResponse(batch));
      }
      // Long-poll: segura até 50s ou até chegar notificação
      if (waitingPull) {
        clearTimeout(waitingPull.timer);
        reply(waitingPull.res, pullMessagesResponse([]));
      }
      const timer = setTimeout(() => {
        if (waitingPull && waitingPull.res === res) {
          waitingPull = null;
          reply(res, pullMessagesResponse([]));
        }
      }, 50_000);
      waitingPull = { res, timer };
      // Se o socket cair de verdade, libera o slot (req 'close' dispara no fim
      // da mensagem em Node moderno — usar o socket, não o req).
      res.socket?.once('close', () => {
        if (waitingPull && waitingPull.res === res) {
          clearTimeout(waitingPull.timer);
          waitingPull = null;
        }
      });
      return;
    }
    if (has('Renew')) return reply(res, renewResponse());
    if (has('Unsubscribe')) return reply(res, soap('<wsnt:UnsubscribeResponse/>'));

    return reply(res, fault('Unknown operation'), 400);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[sim] Câmera ONVIF simulada em ${BASE} (user=${USERNAME}, qualquer senha)`);
  console.log(`[sim] Controles: GET /sim/motion?value=1|0, /sim/tamper?value=1|0, /sim/health`);
});
