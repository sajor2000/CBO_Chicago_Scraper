# ChicagoHealthMap CBO Verifier — Design

## World

Light civic operate workspace. Quiet lake-blue accent on warm paper neutrals. Precise, dense enough for queue work, never decorative.

## Typography

- Display / brand: **"Fraunces"** (soft serif for product name only)
- UI / body: **"Source Sans 3"** (headings, labels, controls, data)
- Scale (rem): 0.75 / 0.875 / 1 / 1.125 / 1.375 / 1.75 — ratio ~1.15
- Body measure for instructional prose ~65ch; queue rows stay denser

## Color

```
--ink: #1a2430
--ink-muted: #4a5a6a
--paper: #f3efe6
--paper-raised: #fffdf8
--line: #d5cfc3
--accent: #0b6e6a
--danger: #9b2c2c
--focus: #0b6e6a
```

Accent only on primary actions, focus rings, and status marks. No purple. No pure black. Secondary text is a tinted ink, never gray-on-color.

## Layout

- Single column work surface, max ~56rem
- Sticky app header: brand + user control
- Operator pilot block above the queue when authorized
- Generous space between sections; tight grouping inside a queue row or field pair
- Mobile: stack; no side panels required for the pilot

## Components

- Primary button: filled accent; secondary: outlined ink; reject: danger outline
- Checkboxes and textareas share one form vocabulary
- Status chips: quiet text + soft tint, not pills-as-decoration
- Empty / denied / auth states include one recovery link or sentence

## Motion

- Status message fade-in (~180ms ease-out)
- Primary button busy opacity / label swap
- Queue row focus-visible outline only—no page-load choreography

## Surfaces

- `/review` — operate: pilot + queue
- `/review/[id]` — operate: evidence compare + decision
- Sign-in — operate: Clerk embed, calm chrome
