# Design

## Style Summary

Dark, restrained product UI for a local accounting workflow. The interface should feel like a quiet cashier workstation in low office light: high contrast, minimal decoration, large touch targets, clear status filtering, and a light paper-like signature surface inside an otherwise dark application.

## Color Tokens

```css
:root {
  --bg: oklch(0.115 0.014 150);
  --bg-deep: oklch(0.085 0.012 150);
  --panel: oklch(0.155 0.014 150);
  --surface: oklch(0.225 0.016 150);
  --ink: oklch(0.94 0.006 150);
  --muted: oklch(0.68 0.012 150);
  --line: oklch(0.33 0.016 150);
  --primary: oklch(0.72 0.115 150);
}
```

Semantic status colors stay subdued: green for full receipt, amber for partial receipt, yellow-brown for pending.

## Typography

Use a high-end sans stack: Geist, Satoshi, Cabinet Grotesk, Plus Jakarta Sans, system UI fallback. Keep labels above inputs. Use tabular figures for counts and amounts.

## Components

- The payout page is a two-column workstation on desktop and collapses to one column on tablet/mobile.
- Search and status filters live together as the main operating toolbar.
- The payout list hides amounts; amounts appear only in the signature modal and exported report.
- Signature modal uses a dark shell with a light signature canvas for finger/stylus clarity.
- Buttons have tactile active states and visible focus/hover states.

## Motion

Use short CSS transitions with `cubic-bezier(0.16, 1, 0.3, 1)` and small opacity/translate reveals. Respect reduced motion. No JS animation library is required for this workflow.
