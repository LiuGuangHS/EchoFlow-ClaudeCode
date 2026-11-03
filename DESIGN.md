# EchoFlow Code Desktop Design

This document defines the product-wide visual direction for the desktop app.
It is a design decision record and review standard, not a second component API
or a pixel-by-pixel specification.

## Source of truth

- `desktop/src/theme/globals.css` owns theme values and semantic design tokens.
- `desktop/src/components/AGENTS.md` owns component selection, implementation,
  accessibility, localization, and test contracts.
- This file owns visual principles, page roles, and consistency decisions.
- `desktop/docs/redesign-paper-ink-seal.md` is a historical design handoff.
  Its old measurements and implementation checklist are not current authority.

When these documents appear to conflict, token values come from `globals.css`,
implementation rules from the component guide, and product-level visual
decisions from this file. Update the owning source rather than copying values.

## Product character

EchoFlow Code is a dense coding workspace used for sustained reading, editing,
and operational control. Its visual language should feel calm, precise, and
distinctive without reducing code, conversations, diffs, or settings to
decoration.

The current direction is **Ink Workbench**: a paper desk where content stays
stable, controls lift only when they are active, and a seal marks a meaningful
decision. The identity is not a global transparency effect or a warm palette;
it comes from the relationship between reading surfaces, action surfaces, and
execution state.

Use these material roles consistently across all six themes:

| Role | Use for | Non-negotiable rule |
|---|---|---|
| Paper | Chat, code, diff, terminal, trace detail, workspace, settings, dialogs | Opaque and readable; translucency never sits behind long-form content |
| Ink | Sidebar, tabs, toolbar, activity chrome, compact tool summaries | Theme-tokenized control surface; active elements may lift, idle elements stay quiet |
| Seal | Permission decisions, brand entry points, primary actions, completion feedback | Sparse semantic accent; never a substitute for warning, error, success, or focus |
| Glass | Short-lived anchored menus, popovers, composer shell, glance overlays | Enhancement only; must fall back to an opaque theme surface |

The **execution spine** is the shared visual relationship between a session's
Tool rows, Activity, navigation markers, and permission surface. It is a
presentation rule, not a second state store: when multiple signals coexist,
waiting or permission takes precedence over error, error over running, and
running over completed. Every state also needs text, an icon, or a semantic
status marker; color, glow, or motion alone is never sufficient.

Preserve this identity across all six themes; themes change the palette, not
the information hierarchy or interaction language.

## Design principles

1. **Content stays legible.** Reading and editing surfaces use stable,
   high-contrast fills. Do not place translucency behind long-form text,
   code, diffs, terminal output, or forms.
2. **Hierarchy comes from structure.** Use alignment, spacing, typography,
   surface levels, and restrained borders before adding shadows or decorative
   cards. A card is for a distinct item or genuinely framed tool, not a default
   wrapper for every section.
3. **One action, one visual meaning.** Primary actions, destructive actions,
   selected states, and status colors keep the same semantic treatment across
   the app. Do not use brand color as decoration where it competes with state.
4. **Density follows the task.** Settings, trace inspection, and workspace
   lists may be compact; onboarding and empty states may breathe. Compactness
   is intentional when labels remain readable and controls remain usable.
5. **Motion explains change.** Prefer short, user-triggered transitions.
   Respect reduced-motion settings; avoid ambient movement and repeated
   entrance effects.
6. **Every theme is a first-class theme.** Use semantic tokens, preserve
   contrast, and verify light and ink palettes. Avoid one-off color fixes that
   only work in the default theme.

## Material and glass decision

Use **Ink Workbench**, not desktop-wallpaper transparency. Electron windows
remain opaque; system vibrancy would introduce platform-specific behavior and
make the workspace background less predictable.

Paper is the default for sustained reading and editing. Ink is the control
layer that groups navigation and active work. Seal is reserved for a meaningful
brand or decision moment. Glass is only a short-lived enhancement of an Ink
surface, never a new content layer.

Glass is allowed only for compact, temporary surfaces such as a small anchored
menu, popover, composer shell, or glanceable overlay. It is not the default
surface for the sidebar, title bar, chat transcript, code/diff/terminal,
settings forms, permission or other dialogs, trace details, or workspace
content. Large or scrollable surfaces must remain opaque. Glass must retain its
theme fill and visible border, and must fall back to an opaque theme surface
when `backdrop-filter` is unavailable, transparency is reduced, or forced
colors are active. Long text and detailed previews inside a glass shell belong
on an opaque inner surface.

Do not use the brand token as a waiting, success, error, or keyboard-focus
substitute. Waiting and permission use their paired warning container tokens;
errors use error tokens; focus uses the focus-border token. Each state keeps a
non-color cue such as text, an icon, or a semantic status marker.

Before expanding glass usage, inspect it in the component gallery against all
six themes, with dense text behind it and with blur unavailable. A screenshot
or rendered check is required for visual changes; source-level class counts do
not prove that glass looks good.

## Page roles

Use a small set of page roles rather than forcing every route into one template:

| Role | Examples | Visual emphasis |
|---|---|---|
| Work surface | Active session, workspace, terminal | Maximum reading area; quiet chrome; controls grouped near the work they affect |
| Configuration | Desktop settings, provider/runtime settings | Clear page title, labelled sections, compact aligned fields, explicit save/apply state |
| Mobile configuration | H5 settings | Touch-first navigation and controls; a focused subset of desktop configuration, not a squeezed desktop page |
| Catalog | Market, extension/skill browsing | Search and filters before results; repeated entries optimized for comparison |
| Inspection | Trace, activity, agent teams | Strong master/detail or timeline hierarchy; dense data remains scannable |
| Focused dialog/task | Permission, confirmation, import | One decision or short task; opaque surface, clear consequence, concise actions |

These roles guide composition, not new behavior. Do not remove existing
capabilities or invent features to make a page fit a visual template.

### Role-to-component boundary

Prefer the existing primitive for the generic part of a page, while keeping
its domain-specific rows and state local:

| Page role | Prefer existing primitives | Keep domain-owned |
|---|---|---|
| Work surface | `Button`, `IconButton`, field primitives, `Badge`, `StatusDot`, `Dropdown` | Chat messages, tool blocks, permission blocks, workspace file/diff surfaces |
| Configuration | `Input`, `TextArea`, `SelectField`, `SearchField`, `Button`, `ActionDialog` | Provider/runtime forms whose validation or persistence is feature-specific |
| Catalog | `Input`, `SearchField`, `Button`, `Card`, `Badge` | Market cards, install flows, capability rows, comparison-specific layout |
| Inspection | `Badge`, `StatusDot`, `Modal`, `Dropdown`, `Tooltip` | Trace trees/details, activity rows, agent-team and evidence structures |
| Focused dialog/task | `Modal`, `ConfirmDialog`, `ActionDialog`, `MobileBottomSheet` | Permission and plan-mode actions whose consequences and payloads are domain-specific |

This table guides adoption; it does not require every native element to be
replaced. Tabs, menus, trees, grids, task rows, window controls, and domain
items keep their own semantics even when their markup resembles a shared
primitive.

A shared state mapping is valid only when the state type, lifecycle, visible
meaning, and accessible cue are the same. Do not merge focus with waiting,
brand with warning, or disclosure state with modal focus management. Preserve
`disclosureMemory`, modal focus trap/restore, and `useDismissable` Escape and
outside-dismiss behavior as separate contracts.

Local stacking contexts, companion-pet glass treatment, and page-specific
radius or surface exceptions may remain local when they have a documented
reason and do not weaken readability or token ownership. Source counts are
only audit signals; glass, six-theme contrast, dense text, and narrow-viewport
behavior require rendered evidence.

## Type and spacing

The current font tokens resolve as follows: `--font-body` is the interface
sans-serif; `--font-headline` currently aliases `--font-body` and is also
sans-serif; `--font-serif` is an explicit editorial serif option; and
`--font-mono` is for code and machine-shaped values. Use the serif role only
where an editorial heading is an intentional design choice; do not assume
`--font-headline` supplies it. Changing the token mapping is a separate design
system decision. The current code contains many literal pixel sizes, including
fractional values; those counts establish drift opportunity, not proof that
every distinct size is visually wrong.

For new or substantially revised UI, choose from a compact semantic ladder:

| Role | Guidance |
|---|---|
| Compact metadata | 11–12px; secondary information, never essential instructions |
| Dense control text | 13–14px |
| Body and form labels | 14–16px |
| Section heading | 16–18px |
| Page heading | 24–28px; current `--font-headline` is sans-serif, use `--font-serif` only for an intentional editorial treatment |
| Large value | 21–26px, only when the value is the point of the view |

This is a target for convergence, not an instruction to mechanically replace
every existing size. Do not use fractional font sizes for new work unless a
measured layout constraint requires one. Prefer existing spacing and radius
tokens; retain exceptions that encode a real touch target, joined control,
media crop, or page-specific layout.

## Surfaces and floating layers

- Page sections are unframed layouts or full-width bands. Do not nest cards.
- Use a card for an independently meaningful repeated item or framed tool.
- Sustained reading surfaces use Paper. Do not make code, diffs, terminal output,
  trace details, workspace content, settings forms, or long lists translucent.
- Navigation and compact work controls use Ink semantics. Active items may have
  a restrained lift; idle items do not accumulate decorative shadow.
- Menus and popovers should share theme surface, border, elevation, focus,
  dismissal, and keyboard behavior. Specialized content may change dimensions,
  not the basic surface language. A glass shell never makes its detailed
  content translucent.
- Dialogs are opaque and use the dialog surface contract. A media viewer may
  use its own content surface.
- Bottom sheets are touch-specific dialog-like surfaces; their shape and
  interaction may differ while preserving the same theme and focus standards.
- Toasts communicate outcomes and should not imitate menus or cards.
- Tool summaries may use a compact row when their content is short and
  expandable; diffs, terminals, previews, long output, and error detail remain
  framed opaque content. Do not convert every tool call to a row.

The current implementation has shared tokenized elevation and z-index scales,
but menu-like surfaces still include both `.glass-panel` and independently
assembled opaque panels with different radii and shadows. Consolidate these
only when a behavior-focused change touches them; do not start a risky global
rewrite solely to make class strings identical.

## Controls and interaction

Use the shared UI primitives for generic controls. Hand-built buttons are
appropriate for domain-specific rows, tabs, tree nodes, and window controls,
but must preserve the same keyboard, focus, disabled, and theme semantics.
Use semantic tokens rather than raw palette values. Focus must be visible;
hover must not be the only indication of state. Honor reduced motion and keep
touch targets appropriate for the H5 surface.

Extract a component only when at least two real consumers share the same
semantic behavior, not merely similar markup. Verify the boundary against
keyboard and focus behavior, Escape and outside dismissal, localization,
theme states, touch targets, and business coupling. Keep one-off domain rows,
tabs, trees, grids, and window controls local when their semantics differ.
Existing primitives are preferred over new wrappers; a new abstraction must
preserve current stores, APIs, routes, permission payloads, and state flow.

The source currently has 207 native button elements alongside 474 shared
`Button`/`IconButton` usages, and 65 native input/select/textarea elements
alongside 104 shared field usages (rough source counts, excluding tests).
These figures indicate that shared primitives are not universal, but do not
classify each native element as a defect: inspect its role and interaction
before changing it.

## Review checklist

- Does the page communicate its role and primary task without adding chrome?
- Are primary, secondary, destructive, selected, and status treatments
  consistent with their meaning?
- Are text and controls readable in all six themes and at the target density?
- Are large reading/form surfaces opaque, and is glass restricted to suitable
  short-lived surfaces?
- Are generic controls using shared primitives, with exceptions justified by
  their domain-specific behavior?
- Are focus, keyboard operation, localization, and reduced motion preserved?
- For visible changes, was the rendered UI checked in the relevant themes and
  viewport sizes? If not, record that visual evidence is unavailable.

## Audit evidence and limits

The current audit directly inspected theme tokens/tests, representative shared
components, page headers, and representative menu, dialog, sheet, and chat
surfaces. It also counted source patterns such as literal font sizes, native
controls, focus classes, and motion preferences. Those counts are exploratory
signals, not a complete visual inventory.

No rendered screenshot comparison was produced during this audit. In
particular, global color exceptions, icon-family differences, and page-by-page
spacing need rendered review before being treated as confirmed visual defects.
