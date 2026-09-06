---
name: Alarm active card shape
description: Default alarm and application surfaces remain rectangular with a subtle 4px radius.
---

Application cards and panels should keep the standard rectangular surface treatment with a subtle 4px radius. Only components with an explicitly requested, self-contained geometry should use a custom clip-path.

**Why:** The broad chamfer treatment made diagonal borders unreliable and visually inconsistent across the application; the user explicitly preferred the earlier rectangular surfaces.

**How to apply:** Keep global surface compatibility rules at `border-radius: 4px` with no clip-path. Isolate any future custom geometry to a dedicated component instead of applying it through broad selectors.