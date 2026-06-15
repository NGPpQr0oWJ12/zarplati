# Design

## Style Summary

Minimal product UI for a local accounting workflow. The visual language is quiet, document-like, and touch-friendly: white canvas, soft neutral panels, thin dividers, restrained moss accent, clear statuses, and large signature controls.

## Color Tokens

```css
:root {
  --bg: oklch(1 0 0);
  --surface: oklch(0.975 0.002 150);
  --surface-strong: oklch(0.94 0.004 150);
  --ink: oklch(0.18 0.012 150);
  --muted: oklch(0.48 0.01 150);
  --line: oklch(0.88 0.004 150);
  --primary: oklch(0.4 0.106 150);
  --primary-hover: oklch(0.34 0.106 150);
  --danger: oklch(0.46 0.13 25);
  --success-bg: oklch(0.93 0.036 150);
  --warning-bg: oklch(0.95 0.04 85);
}
```

## Typography

Use a system sans stack for every UI element. Keep labels direct, headings compact, and numeric amounts aligned with tabular figures.

## Components

- Buttons use a 6px radius, no shadows, clear hover and focus states.
- Inputs are large enough for tablet use and keep a consistent 1px border.
- The signature canvas is a plain bordered writing area with explicit clear and confirm actions.
- Tables collapse to stacked rows on mobile and tablet widths.

## Motion

Only state feedback transitions of 150-200ms. Respect reduced motion.
