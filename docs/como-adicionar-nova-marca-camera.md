# Como Adicionar uma Nova Marca de Câmera

Este guia explica como adicionar suporte a um novo fabricante de câmera ao sistema de monitoramento do BlueBee, incluindo perfil de OIDs no gateway e no backend.

---

## Visão Geral

O suporte a um fabricante envolve quatro camadas:

| Camada | Arquivo | Responsabilidade |
|--------|---------|-----------------|
| Gateway — tipos | `apps/gateway/src/profiles/types.ts` | Interface `DeviceProfile` |
| Gateway — perfil | `apps/gateway/src/profiles/vendors/<marca>.profile.ts` | OIDs proprietários |
| Gateway — registro | `apps/gateway/src/profiles/profile-registry.ts` | Adicionar ao `ALL_PROFILES` |
| Backend — catálogo | `apps/backend/src/modules/devices/application/camera-oid-profiles.ts` | Pre-fill no cadastro e probe |

---

## Passo 1: Criar o perfil no gateway

Crie o arquivo `apps/gateway/src/profiles/vendors/<marca>.profile.ts`:

```typescript
import type { DeviceProfile } from '../types';

export const NOVA_MARCA_PROFILE: DeviceProfile = {
  id: 'nova-marca',
  label: 'Nova Marca',
  deviceTypes: ['CAMERA'],
  priority: 10,              // > 0 = vendor (nunca use 0, reservado ao base)
  bestEffort: false,         // true apenas se a câmera pode responder sentinelas
  match: {
    // Substrings procuradas (case-insensitive) no sysDescr SNMP:
    sysDescrContains: ['novamarca', 'nova_marca'],
    // (opcional) Substrings no fabricante do probe ONVIF:
    manufacturerContains: ['nova marca'],
    // (opcional) Enterprise numbers do sysObjectId:
    enterpriseNumbers: [12345],
  },
  mappings: [
    // CPU: OID proprietário (OID da MIB do fabricante)
    { metricKey: 'cpu',         oid: '1.3.6.1.4.1.12345.1.7.0',  unit: '%',  valueType: 'float' },
    { metricKey: 'memory',      oid: '1.3.6.1.4.1.12345.1.11.0', unit: '%',  valueType: 'float' },
    { metricKey: 'temperature', oid: '1.3.6.1.4.1.12345.1.4.0',  unit: '°C', valueType: 'float' },
    // Inclua uptime se disponível; senão o base-camera já o traz via MIB-II.
  ],
};
```

**Regras importantes:**
- `id` deve ser **único** e corresponder ao id no backend (`camera-oid-profiles.ts`).
- `priority > 0` para perfis de fabricante; `0` é reservado para `base-camera`.
- `bestEffort: true` só para câmeras cujo firmware responde valores-sentinela (ex.: Intelbras/Dahua com `0` fixo em temperatura ausente). Ativa alarmes "melhores esforços" no driver.
- Sempre inclua `'CAMERA'` em `deviceTypes`.

### Scale (fator de conversão)

Se o OID retorna mili-unidades, defina um `transform` no mapeamento:

```typescript
{
  metricKey: 'temperature',
  oid: '1.3.6.1.4.1.12345.1.4.0',
  unit: '°C',
  valueType: 'float',
  transform: (v: number) => v / 1000,   // mili-°C → °C
}
```

---

## Passo 2: Registrar no profile-registry do gateway

Em `apps/gateway/src/profiles/profile-registry.ts`:

```typescript
import { NOVA_MARCA_PROFILE } from './vendors/nova-marca.profile';

export const ALL_PROFILES: DeviceProfile[] = [
  HIKVISION_PROFILE,
  DAHUA_PROFILE,
  INTELBRAS_PROFILE,
  AXIS_PROFILE,
  NOVA_MARCA_PROFILE,   // ← adicionar aqui
  BASE_CAMERA_PROFILE,
];
```

---

## Passo 3: Adicionar ao catálogo do backend

Em `apps/backend/src/modules/devices/application/camera-oid-profiles.ts`, adicione
uma entrada ao array `CAMERA_OID_PROFILES`:

```typescript
{
  id: 'nova-marca',            // deve bater com o id do gateway
  label: 'Nova Marca',
  match: ['novamarca', 'nova marca'],   // match contra fabricante ONVIF (lowercase)
  oids: {
    cpu:         { oid: '1.3.6.1.4.1.12345.1.7.0',  scale: 1,     unit: '%'  },
    memory:      { oid: '1.3.6.1.4.1.12345.1.11.0', scale: 1,     unit: '%'  },
    temperature: { oid: '1.3.6.1.4.1.12345.1.4.0',  scale: 0.001, unit: '°C' },
  },
},
```

> O backend usa este catálogo para:
> 1. Pre-preencher os OIDs no cadastro da câmera (dropdown "Identificar perfil").
> 2. Executar o probe de capacidades via `CapabilityProbeService`.
> 3. Exibir os perfis disponíveis em `GET /cftv/profiles`.

---

## Passo 4: Adicionar ao `detectProfileFromSnmpProbe`

No `CapabilityProbeService`, a função `detectProfileFromSnmpProbe` usa as strings do
`match` dos perfis em `CAMERA_OID_PROFILES`. Como você adicionou o perfil no passo 3,
a detecção funcionará automaticamente — não há código extra a escrever.

Se o fabricante usa um enterprise number proprietário (diferente de 1004849), adicione
o mapeamento em `ENTERPRISE_TO_PROFILE`:

```typescript
const ENTERPRISE_TO_PROFILE: Record<number, string> = {
  39165:   'hikvision',
  1004849: 'intelbras',
  368:     'axis',
  12345:   'nova-marca',   // ← adicionar aqui
};
```

---

## Passo 5: Bump de versão do gateway

O gateway versionado garante que dispositivos em campo recebam o perfil atualizado via OTA.

```bash
# apps/gateway/package.json
"version": "1.13.1"   # incrementar o patch

# Atualizar o manifesto:
pnpm --filter @bluebee/gateway run manifest --update
```

---

## Passo 6: Escrever testes

Adicione casos em `apps/gateway/src/profiles/profile-registry.spec.ts`:

```typescript
it('detecta Nova Marca por sysDescr', () => {
  const p = resolveProfile({ sysDescr: 'NovaMarca IP Camera FW3.2' });
  expect(p.id).toBe('nova-marca');
});

it('detecta Nova Marca pelo enterprise number 12345', () => {
  const p = resolveProfile({ sysObjectId: '1.3.6.1.4.1.12345.1' });
  expect(p.id).toBe('nova-marca');
});
```

E em `apps/backend/src/modules/devices/application/capability-probe.service.spec.ts`:

```typescript
it('detecta Nova Marca por sysDescr', () => {
  const p = detectProfileFromSnmpProbe('NovaMarca Camera', null, null);
  expect(p.id).toBe('nova-marca');
});
```

---

## Resumo de checklist

- [ ] `apps/gateway/src/profiles/vendors/<marca>.profile.ts` criado
- [ ] `ALL_PROFILES` em `profile-registry.ts` atualizado
- [ ] `CAMERA_OID_PROFILES` em `camera-oid-profiles.ts` atualizado
- [ ] `ENTERPRISE_TO_PROFILE` atualizado (se houver enterprise number)
- [ ] Versão do gateway incrementada
- [ ] Manifesto do gateway atualizado (`pnpm run manifest --update`)
- [ ] Testes escritos nos dois spec files
- [ ] `pnpm tsc --noEmit` sem erros em gateway + backend
