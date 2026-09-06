---
name: SCADA ScreenDevice classification (SCA/NVR/camera/switch)
description: How ScreenDevice union types (Controller, ManagedNvr, ManagedSwitch, Camera) are told apart when all can share protocol='snmp'.
---

`GET /sca/controllers` (frontend `Controller` type) does **not** return a
`monitoredDeviceType` field, unlike `ManagedSwitch`/`ManagedNvr`
(`monitoredDeviceType: 'SWITCH'`/`'NVR'`). Its only distinguishing trait is
`protocol === 'snmp'` with no other marker.

`Camera` is the only `ScreenDevice` variant with a `monitoringProtocol` field
(`'snmp' | 'onvif'`) — this is what makes it possible to exclude Camera from
other SNMP-protocol types without a shared discriminant.

**Rule:** `isControllerDevice` must be exclusion-based: not switch, not NVR,
no `monitoringProtocol` field, and `protocol === 'snmp'`. Any future
`ScreenDevice` variant that also uses `protocol: 'snmp'` (e.g. a new
equipment type) must add its own positive discriminant field, or it will
silently be misclassified as a Controller by this exclusion logic.

**Why:** `apps/frontend/src/modules/scada/types/virtual.types.ts` merges
several independently-designed device DTOs into one `ScreenDevice` union for
the SCADA point-binding selector; only `isCameraDevice`/`isSwitchDevice`
existed before, and adding Controller/NVR required exclusion logic since the
SCA DTO has no positive marker.

**Known related data-quality issue:** at least one real SCA controller
device has multiple `DevicePoint` rows sharing the same `tag`
(`MEMORYUSEDPERCENT`, different `instance`s) — this triggers a React
duplicate-key warning in any list keyed by `p.tag` (binding selector, device
point pickers) once that device becomes selectable. The DB unique constraint
on `device_points` is `(deviceId, objectType, instance)`, not tag, so nothing
prevents duplicate tags per device. Not fixed as part of surfacing
Controller/NVR in the SCADA binding selector — tracked as a follow-up.
