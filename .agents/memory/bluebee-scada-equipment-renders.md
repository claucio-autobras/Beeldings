---
name: SCADA equipment renders
description: Equipment widgets use AI-generated isometric PNG renders, not recolored SVGs; state shown via glow+LED.
---
User rejected hand-drawn SVG equipment icons (flat and iso styles) as "not modern"; approved AI-generated realistic isometric 3D renders instead.

**Rules:**
- 15 built-in equipment PNGs live in `apps/frontend/public/scada-equipment/<type>.png` (transparent bg, generated via media-generation with a shared "digital-twin, light gray/white, isometric" prompt style + removeBackground). Regenerate with the same style string to keep the set consistent.
- PNGs are TRIMMED (sharp trim + ~5% uniform transparent margin) and the widget renders them fitting the whole width×height rect (not min-dim square). The `EQUIPMENT_ASPECT` map in EquipmentWidget.tsx hardcodes each render's w/h ratio for deterministic overlay placement (LED/level bar/offline icon) — if any PNG is regenerated or re-trimmed, re-measure and update the map in lockstep, or overlays drift.
- Legacy widgets without `padding` get a ~5% min-dim margin (was 78% square); box position/size unchanged, drawing just fills better.
- State color is NEVER applied by recoloring the render. It's shown as: drop-shadow glow around the image + round status LED at top-right. Glow only when a stateRule matched; base color = plain render + LED in base color. Offline = grayscale container filter + gray LED + WifiOff.
- Tank level = vertical gauge bar overlaid on the right of the image (fill = levelColor) + numeric label below; no more SVG liquid clipping.
- `iconAssetUrl` (user-uploaded image) branch takes precedence and is unchanged (colored border + boxShadow).
- Camera (CFTV) also uses PNG renders now (bullet `camera.png` + dome `camera-dome.png`, chosen via `cameraModel`, default bullet); its old color-driven SVG is gone. Status LED is per-widget optional via `showStatusLed !== false` (absent = shown, backward compatible); label size via `labelFontSize ?? 11`.
- Generation gotcha: prompts must forbid brand text explicitly ("blank unbranded housing, no letters") — one render came out with SIEMENS printed on it and needed regeneration.

**Why:** keeps realism of renders while preserving all state-rule/animation/staticRender semantics and saved-screen JSON compatibility (no schema change; only the default rendering path changed).
