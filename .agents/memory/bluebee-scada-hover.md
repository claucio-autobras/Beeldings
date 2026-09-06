---
name: SCADA hover/status border CSS surfaces
description: Why hover "content" fill and status-border effects must never paint a raw rectangle, and how the two coexist without duplicating.
---

## The trap
Any generic overlay effect (hover, status-by-value) that paints via a plain
`background`/`outline`/`boxShadow` on a widget's outer box will visually
"square off" anything with real geometry underneath (SVG `rx`, circles,
rounded cards). The fix is never "add border-radius to the wrapper" — it's to
recolor the widget's *own* paint (fill/stroke on the real vector/HTML element)
via a CSS attribute-marker + CSS var, never a synthetic box on top.

## Three distinct SVG content-surface markers (do not conflate)
- `data-scada-hover-content-surface` — real HTML boxes only; sets
  `background`/`background-color`. **Never put this on an `<svg>` root** — an
  SVG root is a rectangular HTML box with no `border-radius` synced to its
  internal `rx`, so a background here reintroduces the square-fill bug.
- `data-scada-hover-fill-surface` — SVG element painted via `fill` (e.g.
  thermometer liquid/bulb, progress-bar fill rect). Sets only `fill`.
- `data-scada-hover-content-stroke-surface` — SVG element painted via
  `stroke`+`fill="none"` (e.g. gauge value arc). Sets only `stroke`.

## Status-border unified with hover-border
Status-by-value border effects reuse the exact same native surface markers as
hover-border (`data-scada-hover-border-surface`, `data-scada-shape`,
`data-scada-pipe`, `data-scada-line`, `data-scada-separator`) via a parallel
`data-scada-status-border` attribute + `--scada-status-border` CSS var. The
status-border CSS block is declared **before** the hover-border block in
globals.css, so on a tie (both active on the same widget) hover wins by
source order at equal specificity — this is the documented, deliberate
priority. `isSelected` (editor cyan outline) must also suppress the native
status-border color, not just the old fallback outline, or selecting a
widget with an active status rule shows two colors at once.

## Fallback exception: `led-status`
`led-status` is declared "border"-capable in `HOVER_BORDER_TYPES` (the
properties panel offers the option) but its LED is a plain `<div>` circle
with no real border/stroke to recolor — it is the one widget type that still
needs the old rectangular outline/boxShadow fallback on the wrapper. Any
future audit of "declared capable but no real paint surface" gaps should
start by grepping each `HOVER_BORDER_TYPES`/`HOVER_CONTENT_TYPES` entry's
actual JSX for a genuine `border`/`fill`/`stroke` on the marked element —
lucide icon `<svg stroke="currentColor">` DOES work (author CSS overrides
the presentation attribute) but `IconWidget`'s uploaded-image-asset variant
(`<img>`, no SVG) is a similar unresolved gap.

## Testing hover states end-to-end
The Screenshot tool can't simulate `:hover` (no mouse interaction). Use the
testing skill's Playwright subagent, and drive it through the editor's
"Preview" button (top-right toolbar, sets `previewMode`) to get live
hover/status behavior — the raw editor canvas renders `staticRender=true`
(status ignored, hover still styled but not evaluated against live values).
