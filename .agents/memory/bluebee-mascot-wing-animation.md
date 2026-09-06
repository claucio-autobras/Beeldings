---
name: BlueBee mascot wing animation
description: Reliable approach for animating the BlueBee mascot's wings in the commercial video.
---

The BlueBee mascot asset contains the body and wings in one transparent PNG, so broad CSS slices can accidentally animate the head, shoulder, or background. Independent wing motion should use precise SVG masks and clip paths in the asset's native 364×327 coordinate space, leaving the wing roots behind the stable body layer.

**Why:** A first gradient-based split made the motion read as body distortion rather than flight and risked visible ghosting.

**How to apply:** Keep the body stable, isolate only the outer translucent wing contours, animate each wing group in 2D with root-based transform origins, and validate consecutive 24 fps frames before exporting.