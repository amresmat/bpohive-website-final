---
name: BPO Hive
version: 1
tokens:
  color:
    ground: "#ffffff"
    surface: "#eef4f8"
    navy: "#081521"
    navy-2: "#0d1d2b"
    ink: "#102534"
    muted: "#4f6575"
    accent: "#0f7ac4"
    accent-hover: "#0c6cae"
    accent-light: "#9bd5ff"
    on-dark: "#ffffff"
    on-dark-muted: "#aebfca"
  type:
    family: "Archivo"
    display-stretch: "108%"
    display-weight: 700
    body-size: "17px"
    display: "clamp(44px, 2.3rem + 3.9vw, 88px)"
    heading: "clamp(32px, 1.5rem + 2.6vw, 58px)"
    lead: "clamp(18px, 1rem + .5vw, 21px)"
    small: "14px"
  radius:
    control: "4px"
    panel: "0px"
    ui-fragment: "10px"
  space:
    section-desktop: "112px"
    section-mobile: "72px"
    gutter: "min(1180px, 100% - 40px)"
---

# BPO Hive design contract

Who this is for: B2B founders and sales leaders who want booked meetings, not a pitch about
"lead generation". The world of the subject is the phone call, the calendar invite, the call
recording, the note from the caller. Every visual on the site is one of those artifacts, drawn
as itself. No abstract shapes, no glows, no stock photos.

## Direction

- **Ground:** white. Dark navy only for three moments: the opening (hero), the surprise (the
  portal), and the close (final call to action). Everything between is light, with the pale
  `surface` tone separating sections where one is needed.
- **Accent:** one blue (`#0f7ac4`, the logo's family) on the primary action and links. Not on
  headings, numbers, icons or borders.
- **Type:** Archivo for everything, one family. Headings set wider (`font-stretch: 108%`) at
  weight 700, tight (-0.03em). Body at 17px, weight 400. Two or three sizes per screen, far
  apart.
- **Surfaces:** separated by a tone step, not by borders or shadows. No card grids. Shadows
  only on things that float (menus, dialogs, the notification in the hero).
- **Corners:** buttons and inputs 4px; sections and panels square; UI fragments (the meeting
  notification, the portal) 10px because they are drawings of software.
- **Signature:** the booked-meeting notification in the hero, animated once as it would appear
  on a phone. It is the product.

## Rules (what we removed and must not come back)

- No label above a heading (no uppercase eyebrows, no pill badges, no "01 02 03").
- No arrows glued to button or link text.
- No gradient buttons, no gradient text, no glow shadows, no pointer-follow glows.
- No fake window chrome (traffic lights, URL bars) on product mocks.
- No middle-dot strings (`A · B · C`); write commas.
- Numbers only where the content is a real sequence (the six steps are one).
- Sentence case for interface text. Buttons name the action: "Fill my calendar", "See pricing".

## Shared chrome

Header and footer come from `scripts/site-shell.cjs` and `assets/css/site-shell.css` and are
the same on every page. Fonts load from `assets/css/growth.css` on every page.
