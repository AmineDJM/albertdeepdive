# Newsroom UI conventions

The workbench is a dense desktop tool (Linear / Notion energy), the contribution form is a
mobile-first public page. Both use the tokens in `src/app/globals.css`.

## Building blocks (use these, do not reinvent)

- `src/components/ui/*` — shadcn-style primitives (button, input, textarea, label, badge,
  card, table, dialog, alert-dialog, sheet, dropdown-menu, popover, select, native-select,
  tabs, tooltip, switch, checkbox, radio-group, scroll-area, command, toggle, collapsible,
  progress, skeleton, kbd, avatar, alert, empty-state).
- `src/components/newsroom/page-header.tsx` — `PageHeader` (sticky, compact: title 15px,
  optional breadcrumbs/description/actions/meta), `PageBody` (padding 20px), `SectionTitle`
  (small caps label).
- `src/components/newsroom/stat.tsx` — `Stat`, `StatGrid`, `ProgressBar`.
- `src/components/newsroom/status-badge.tsx` — `EditionStatusBadge`, `StoryStatusBadge`,
  `ArticleStatusBadge`, `SubmissionStatusBadge`, `ClusterStatusBadge`, `RightsBadge`,
  `SeverityBadge`, `GenericStatusBadge`.
- `src/components/newsroom/campus-chip.tsx` — `CampusChip`, `CampusList`.
- `src/components/newsroom/data-table.tsx` — `DataTable` (columns array, `onRowHref` makes
  rows navigable through `RowLinkBehaviour`; put `data-no-row-link` on interactive cells).
- `src/components/newsroom/filter-bar.tsx` — URL-synced `FilterBar` (selects + search);
  pages read `searchParams` (async in Next 16) and query the DB with the values.
- `src/components/newsroom/phase-timeline.tsx` — `PhaseTimeline`.
- `src/components/newsroom/cover-thumbnail.tsx` — `CoverThumbnail`.
- Toasts: `toast` from `sonner`. Confirmations: `AlertDialog`. Icons: `lucide-react`.

## Page pattern

```tsx
export const dynamic = "force-dynamic";
export default async function Page({ params, searchParams }) {
  const { editionId } = await params;           // async in Next 16
  const sp = await searchParams;
  const user = await getCurrentUser();          // never trust the client for permissions
  const data = await someService(editionId, sp);
  return (
    <>
      <PageHeader title="…" description="…" actions={hasPermission(user, "x:y") ? <Action /> : null} />
      <PageBody className="space-y-4">…</PageBody>
    </>
  );
}
```

Edition-scoped screens live under `src/app/(newsroom)/editions/[editionId]/<tab>/` (the
edition layout already renders the tab bar). Top-level `/inbox`, `/stories`, `/articles`,
`/media`, `/layout` redirect to the current edition.

## Mutations

- Server actions in an `actions.ts` next to the page: `"use server"`, call
  `requirePermission("…")`, call the service, `revalidatePath`, return `ActionResult`
  (`ok(data, message)` / `toActionFailure(err)`). Never throw to the client.
- Client components call actions inside `useTransition`, show `toast.success(res.message)` /
  `toast.error(res.error)`, then `router.refresh()`.
- Optimistic UI is welcome for toggles and drag-and-drop; always reconcile with the server.

## Density and typography

- Body text 13.5px; table cells 13px; labels use `.label-caps` (11px, uppercase, tracked).
- No giant page titles; the header is 48px tall.
- Numbers use `.tabular`. Use `formatDate`, `formatDateTime`, `relativeTime`,
  `formatCurrency`, `enumLabel` from `src/lib/utils.ts`.
- Colours: `brand` (Briefly cobalt) for active/primary accents, `primary` (ink navy) for
  primary buttons, semantic `success/warning/destructive/info` with `-soft` backgrounds.
- Every list needs an empty state (`EmptyState`) and every async page a `loading.tsx` skeleton.
- Keyboard: all actions reachable by keyboard; dialogs trap focus; `aria-label` on icon buttons.

## Media

- Never expose storage keys to the client; use `mediaUrl(assetId, kind)` / `mediaUrls(ids)`
  from `src/server/media/urls.ts` (signed URLs) and render with a plain `<img>`
  (`// eslint-disable-next-line @next/next/no-img-element` where needed).
