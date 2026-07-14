# Global Footer Design

## Goal

Create a full-width common footer for the service with a clean dark neutral tone, readable business information, responsive layout, and exclusion from the login page.

## Layout

- Full-width footer background spanning the viewport
- Centered inner container with a max-width wider than the main app shell
- Top area split into three columns on desktop:
  - Brand and short beta-service introduction
  - Business registration information
  - Customer support information
- Bottom area split into:
  - Legal policy text links
  - SNS placeholder icon buttons and copyright

## Behavior

- Footer appears in `AppShell` by default
- Login page passes a flag to hide the footer
- On smaller screens, the three-column layout stacks into a single column
- Bottom row collapses into a vertical layout on mobile to avoid overlap
- When the page has a fixed mobile navigation bar, extra bottom padding keeps the footer fully visible

## Content Rules

- Use masked business registration identifiers exactly as provided
- Render policy items as text links pointing to `#`
- Make `개인정보처리방침` visually emphasized
- SNS icons provide hover/focus feedback only and do not navigate
- Copyright states full ownership of service contents

## Visual Direction

- Dark neutral background with subtle tonal gradient
- Soft separators between information groups
- Bright primary text with muted supporting labels
- Rounded social icon buttons with restrained interaction feedback

## Scope Notes

- No new global navigation added
- No footer on the login page
- No external social links connected yet
