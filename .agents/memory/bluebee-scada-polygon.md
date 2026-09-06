---
name: SCADA polygon geometry
description: Constraint for preserving polygon vertices through editor updates and resizing.
---

Polygon geometry is relative to the widget box. A generic width/height update should scale the existing points, but an update that explicitly includes points must preserve those points exactly; vertex editing often sends both the new box and the renormalized point list.

**Why:** Treating every width/height patch as a resize silently overwrites a vertex drag when both kinds of data travel through the same store action.

**How to apply:** Keep the explicit-points check ahead of polygon autoscaling in shared widget update paths, including popup editors and component instances.