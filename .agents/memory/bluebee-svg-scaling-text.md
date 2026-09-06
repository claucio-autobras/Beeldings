---
name: SVG scaling text labels in dashboard charts
description: Why axis/value text in AlarmsOverTimeChart must be HTML overlay, not SVG <text>
---

# SVG viewBox text shrinks with container width

The AlarmsOverTimeChart uses an `<svg viewBox="0 0 900 140" class="w-full">`. Any
`<text fontSize="…">` inside it is measured in SVG user units, so it scales
**proportionally** with the rendered container width. When the card gets narrow
(e.g. a client is filtered and the layout tightens), fixed font sizes become
tiny and unreadable.

**Rule:** render text labels (X-axis day/hour labels AND the per-bar count
values) as HTML `<span>` overlays absolutely positioned over the chart, NOT as
SVG `<text>`.

**How to apply:**
- Wrap the chart container in `relative`.
- Position each label with `left: (cx / CHART_W) * 100%` (cx = bar center in
  SVG units) and `-translate-x-1/2`.
- For value labels, also `top: ((y) / CHART_H) * 100%` (y = bar top) with
  `-translate-y-full`.
- Use a Tailwind fixed size like `text-[11px]` so it never scales.
- Keep the SVG for bars/baseline/rects only (those are fine scaling).

**Why:** viewBox uniform scaling shrinks glyphs; only strokes have
`vector-effect="non-scaling-stroke"`, there is no equivalent for text font size.
