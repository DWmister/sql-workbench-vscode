# Component Guidelines

> How components are built in this project.

---

## Overview

<!--
Document your project's component conventions here.

Questions to answer:
- What component patterns do you use?
- How are props defined?
- How do you handle composition?
- What accessibility standards apply?
-->

(To be filled by the team)

---

## Component Structure

<!-- Standard structure of a component file -->

(To be filled by the team)

---

## Props Conventions

<!-- How props should be defined and typed -->

(To be filled by the team)

---

## Styling Patterns

<!-- How styles are applied (CSS modules, styled-components, Tailwind, etc.) -->

(To be filled by the team)

---

## Accessibility

### Convention: Client-side sorting in read-only Webview tables

**Scope**: Use this pattern when a Webview already owns the complete read-only
row set and sorting does not require another database or extension-host request.

**Contract**:

- Keep the initial database order as an explicit stable index on each row.
- Sort whole row elements, never independent cell values.
- Keep the default state unsorted and provide a path back to the initial order.
- Put the interactive control inside the sortable `th`; update `aria-sort`, a
  visible direction indicator, and the control label together.
- Do not send `postMessage` for a purely local sort.

```html
<th id="name-sort-header" aria-sort="none">
  <button type="button" data-action="sort-name">Name <span aria-hidden="true">↕</span></button>
</th>
<tr data-column-name="created_at" data-original-index="4">...</tr>
```

```javascript
// Correct: one operation moves the complete rows and retains a stable reset key.
body.replaceChildren(...sortedRows);

// Wrong: sorting each column independently can detach metadata from its field.
nameCells.sort();
```

**Validation**:

- Original, ascending, descending, and restored order must be asserted.
- Case-insensitive ties retain their original relative order in both directions.
- Tests assert `aria-sort` and the visible indicator, plus zero extension-host
  messages for sort actions.
- A newly rendered table starts in the original order.

---

## Common Mistakes

<!-- Component-related mistakes your team has made -->

(To be filled by the team)
