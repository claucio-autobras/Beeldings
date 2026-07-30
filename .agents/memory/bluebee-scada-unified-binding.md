---
name: SCADA unified point binding
description: How every SCADA editor component resolves its single bound point, and why status/animation/visibility reuse it.
---

# SCADA unified point binding

Every editor component (incl. static: text, section-title, image, shapes, separator, titled-area, nav, hotspot) exposes ONE "Binding de Ponto" at the top of the properties panel. Status/color/animation and conditional visibility REUSE that single point — they no longer carry their own controller/point selectors.

**Read/write is centralized** in `scada.types.ts`:
- `readWidgetBinding(w)` returns `{deviceId, tag}` — reads the type's primary field, then falls back to legacy points saved on `status`/`visibility` (never lose a saved binding).
- `writeWidgetBinding(w, d, t)` writes to the correct field for the type.
- Field routing by type sets: `UNIFIED_TAGSTATUS_TYPES` (equipment + shapes + line → `deviceId`/`tagStatus`), `UNIFIED_TAG_TYPES` (value/gauge/led/etc. + command widgets → `deviceId`/`tag`), everything else → base `bindingDeviceId`/`bindingTag` on WidgetBase.

**Why:** duplicate point selectors on status/visibility/equipment drifted apart and confused users. `evaluateVisibility(widget, ...)` and `resolveStatus(widget, ...)` now take the whole widget and call `readWidgetBinding`, so a single point drives everything.

**How to apply / gotchas:**
- On (re)bind, strip legacy points from `status`/`visibility` (`clearLegacyPoint` in PropertiesPanel) so old screens don't keep a stale second point.
- Command-button/command-slider are excluded from the unified UI (`NO_UNIFIED_BINDING`) — they keep their own writable BACnet selectors — but they ARE in `UNIFIED_TAG_TYPES`, so their status/visibility still reuse the command point. alarm-group-badge/alarm-counter are excluded entirely (own binding / none).
- `StatusBinding.deviceId`/`tag` are now optional; base status object is `{rules:[], effects:['border']}` with no point.
- Animations: `ScadaAnimation` includes `fade` (`@keyframes scada-fade` opacity 1→0.25); every animCss branch (WidgetRenderer STATUS_ANIMATION, Shape/Line/Equipment widgets) must list it alongside pulse/spin/blink.
- Spreading `Partial<Widget>` (a discriminated union) loses `type` discrimination → cast the merged patch `as Partial<Widget>`; `readWidgetBinding`'s `w as unknown as Record<string,unknown>` cast is needed because some widget members lack an index signature.
