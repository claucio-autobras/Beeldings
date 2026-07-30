---
name: SCADA pinned bars dock (WYSIWYG)
description: Editor docks pinned toolbar/sidebar OUTSIDE the sheet, same reserved space as viewer; clamps shared in scada.types.
---

Rule: pinned project bars (nav-toolbar/nav-sidebar with pinnedToProject) never render on the design sheet. Editor, editor preview and viewer all dock them around the sheet (toolbar above spanning sidebar+sheet width, sidebar left) using the shared clamps `clampPinnedToolbarH` (32–120) / `clampPinnedSidebarW` (48–360) exported from `scada.types.ts`.

**Why:** the viewer scales the sheet to the area REMAINING after the bars, so sheet x=0 = sidebar edge. Overlaying bars on the canvas in the editor made users draw at x≥sidebarW → widget shifted right in the viewer.

**How to apply:** any new surface rendering a screen with pinned bars must reserve the bar space with the shared clamps and filter `isPinnedNavWidget` out of the canvas loop. The screen that OWNS the pinned bar keeps it editable via the dock (click selects; no drag/resize handles — pinned position is ignored). Snap guides and marquee selection must also skip pinned widgets.
