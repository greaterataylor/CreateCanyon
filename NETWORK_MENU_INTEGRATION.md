# DrawDomain-style network menu integration

## What changed

- Added a new top-right network navigation strip to `components/SiteHeader.tsx`
- Added a compact current-site section on the left side of that strip
- Added a vertical divider between the current site area and the new network area
- Added a horizontal divider line below the new network strip to mirror the DrawDomain treatment
- Left the existing CreateCanyon marketplace header content intact below the new strip

## New files

- `components/network-menu/ecosystemMenuData.ts`
  - Data-driven menu tree copied from the DrawDomain menu structure
  - Preserves the required item order so overflow collapses from right to left
- `components/network-menu/useResponsiveMenuOverflow.tsx`
  - Measurement-based overflow helper adapted from DrawDomain
  - Measures real trigger widths and computes how many items fit before showing the hamburger overflow
- `components/network-menu/NetworkMenu.tsx`
  - DrawDomain-style desktop hover menu implementation
  - Includes the top-level network navigation, multi-level Suites flyouts, overflow hamburger, icons, hover handling, outside-click close, and Escape close

## Collapse algorithm

1. Measure the real width of every top-level trigger plus the hamburger trigger.
2. Measure the actual available width of the right-side network container.
3. Starting from the full menu, reduce the visible item count one item at a time until the rendered cluster fits.
4. Because the menu data order is:
   - Artboardr
   - StorySim
   - Suites
   - Network
   - AI
   - DocDome
   - CreateCanyon
   - ZenBinary

   ...overflow naturally removes items from the end in the required order:
   - ZenBinary
   - CreateCanyon
   - DocDome
   - AI
   - Network
   - Suites
   - StorySim
   - Artboardr

5. Hidden items move into one hamburger menu and still render their original nested menu behavior.

## Notes

- The interaction is intentionally modeled after the uploaded DrawDomain behavior rather than redesigning the CreateCanyon header.
- The new menu is additive and does not replace any existing CreateCanyon header region.
