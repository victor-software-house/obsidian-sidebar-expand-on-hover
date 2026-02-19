# Coordinate-based sidebar hover architecture

Replace all mouseenter/mouseleave/elementFromPoint sidebar detection with a single `document.mousemove` handler that uses coordinate math against stored sidebar sizes to determine which region the mouse is in.

## Key discovery

Obsidian stores `leftSplit.size` and `rightSplit.size` (e.g. 325) even when sidebars are collapsed (`display: none; width: 0px`). Combined with `leftRibbon.containerEl.getBoundingClientRect().right` (44px) and `workspace.containerEl.clientWidth` (full window), we can define stable rectangular regions that never depend on sidebar DOM state.

## Region definitions

```
|  ribbon  |     left sidebar region     |        editor        |    right sidebar region    |
0         44                            369                   1027                          1352
           ribbonRight              ribbonRight+leftSize   wsWidth-rightSize            wsWidth
```

The right ribbon is collapsed (width 0) in Obsidian, so it doesn't affect layout.

## Architecture (shared by both plugins)

### Single mousemove handler (rAF-throttled)

One `document.mousemove` listener, gated by `requestAnimationFrame` for perf:

1. Compute `ribbonRight`, `leftSize`, `rightSize`, `wsWidth` on each frame
2. Determine region: `left` | `editor` | `right` based on `event.clientX`
3. On region transition (tracked via `currentRegion` field):
   - **Entering left region** -> expand left sidebar
   - **Entering right region** -> expand right sidebar  
   - **Leaving left region** -> collapse left sidebar (after delay if configured)
   - **Leaving right region** -> collapse right sidebar (after delay if configured)
4. No-op if region unchanged

### Overlay handling (generic)

Obsidian renders all overlays (modals, menus, suggestion popups, tooltips, color pickers, context menus, etc.) **outside** `workspace.containerEl` -- they are appended to `document.body`, not inside `.app-container > .workspace`. This means a single containment check on the event target replaces all class-specific detection:

```ts
if (!this.app.workspace.containerEl.contains(event.target as Node)) return;
```

If the mouse is over any overlay, `event.target` will be inside that overlay, not inside the workspace. The check is:
- **Generic**: handles every overlay type, current and future, with no class names to maintain
- **Free**: `event.target` is already on the event object; `contains()` is a single DOM tree walk, no querySelector
- **No MutationObserver needed**, no frozen state, no `isModalOrMenuOpen()` method

This also means `isModalOrMenuOpen()` (which hardcodes `.modal-container` and `.menu`) is removed entirely.

### What gets removed

- All `mouseenter`/`mouseleave` handlers on sidebar containers, ribbons, and rootSplit
- All hover tracking flags (`isHoveringLeftRegion`, `isHoveringRightRegion`, `isHoveringLeft`, `isHoveringRight`)
- All `elementFromPoint` calls
- All CSS selector matching on `relatedTarget` / `event.target`
- The right trigger zone DOM element (quick-peek-sidebar) -- coordinate check replaces it
- The `isRightEdgeHovering` flag (expand-on-hover) -- region transition replaces it

### What stays

- **Ribbon mouseenter** for left sidebar expansion trigger (expand-on-hover only -- it doesn't use the coordinate approach for initial trigger, only for deciding when to collapse)
- **Pin/dblclick** handlers
- **document mouseleave** (window exit -> collapse both)
- **Resize handle mouseenter** for saving width on drag
- **document click** handler (quick-peek-sidebar)
- **layout-change** handler (quick-peek-sidebar)
- All settings, hotkey commands, CSS variables, overlay mode

Wait -- actually, if we're doing full coordinate-based monitoring, the ribbon mouseenter is redundant. The mousemove handler already detects "mouse entered left region" and expands. The ribbon mouseenter handler is only needed if we want expansion *only* from the ribbon (not from the full sidebar region). 

**Decision point**: Should expansion trigger when the mouse enters *any* part of the left region (x < ribbonRight + leftSize), or only when it enters the ribbon strip (x < ribbonRight)?

For **expand-on-hover**: the original behavior is ribbon-only trigger. But the user wants the sidebar to stay open when hovering its content area. So: **expand when entering the ribbon OR when the sidebar is already expanded and mouse stays in its region. Collapse only when mouse leaves the region.**

This simplifies to: track whether the sidebar is expanded via `leftSplit.collapsed`. If the mouse is in the left region AND sidebar is collapsed, only expand from the ribbon trigger. If the mouse is in the left region AND sidebar is expanded, keep it open. If the mouse leaves the left region AND sidebar is expanded, collapse it.

For **quick-peek-sidebar**: similar, but it has configurable pixel triggers (e.g. 20px from left edge) and expand delays.

## Plugin-specific changes

### sidebar-expand-on-hover

**setEvents rewrite:**

```
ribbon mouseenter -> expandSidebar (existing trigger, unchanged)
resize handle mouseenter -> expandSidebar + save size (unchanged)
document mousemove (rAF-throttled):
  - compute regions from leftSplit.size, rightSplit.size, ribbon rect, wsWidth
  - if mouse NOT in left region AND left sidebar is expanded AND not pinned -> collapse left
  - if mouse NOT in right region AND right sidebar is expanded AND not pinned -> collapse right
  - if mouse near right edge (< RIGHT_EDGE_TRIGGER_PX from wsWidth) -> expand right
  - skip all if event.target is outside workspace.containerEl (generic overlay guard)
document mouseleave -> collapse both (unchanged)
ribbon dblclick -> toggle pin (unchanged)
```

**Remove entirely:**
- rootSplit mouseenter handler
- All mouseenter/mouseleave on leftSidebar, rightSidebar, leftRibbon, rightRibbon (hover tracking)
- `isHoveringLeftRegion`, `isHoveringRightRegion`, `isRightEdgeHovering` flags
- `isModalOrMenuOpen()` method

### quick-peek-sidebar

**onLayoutReady rewrite:**

```
document mousemove (rAF-throttled):
  - compute regions (same math, using leftSplit.size, rightSplit.size)
  - if mouse NOT in left region AND left not pinned AND not isActivelyEditing() -> schedule collapseLeft (with sidebarDelay)
  - if mouse NOT in right region AND right not pinned AND not isActivelyEditing() -> schedule collapseRight (with sidebarDelay)
  - skip all if event.target is outside workspace.containerEl (generic overlay guard)
  - skip all if onlyWhenFocused && !document.hasFocus()
document mouseleave -> collapse both (unchanged)
document click -> collapse on editor click (unchanged)
```

**attachManualEvents rewrite:**

Keep:
- leftRibbonMouseEnterHandler (ribbon trigger for left sidebar)
- leftSplit.containerEl mouseenter -> set isHoveringLeft, add 'hovered' class, trigger expand if collapsed (this is still needed for CSS animation class)
- rightSplit.containerEl mouseenter -> same for right
- resize handle mouseenter triggers

Change:
- Remove `leftSplitMouseLeaveHandler` and `rightSplitMouseLeaveHandler` entirely -- collapse is now handled by the coordinate-based mousemove
- Remove the right trigger zone DOM element -- coordinate check replaces it

Remove:
- rootSplit mouseenter handler

**The `hovered` CSS class**: quick-peek-sidebar uses this class for CSS transitions. We can add it when expanding and remove it when collapsing, instead of on mouseenter/mouseleave. This decouples it from DOM events.

## Collapse delay handling

Both plugins support configurable collapse delays. With the coordinate approach:

1. When mouse leaves a region, start a collapse timer
2. If mouse re-enters the region before the timer fires, cancel it
3. The timer callback checks the region again before collapsing

```ts
private collapseLeftTimer: number | null = null;

// In mousemove, on leaving left region:
if (!inLeftRegion && !leftSplit.collapsed && !pinned) {
  if (!this.collapseLeftTimer) {
    this.collapseLeftTimer = window.setTimeout(() => {
      this.collapseLeftTimer = null;
      // Re-check region from last known mouse position
      if (this.currentRegion !== 'left') {
        this.collapseSidebar(this.leftSidebar);
      }
    }, this.settings.sidebarDelay ?? 0);
  }
}
// On entering left region, cancel pending collapse:
if (inLeftRegion && this.collapseLeftTimer) {
  clearTimeout(this.collapseLeftTimer);
  this.collapseLeftTimer = null;
}
```

For expand-on-hover, the collapse delay is 0 (instant). For quick-peek-sidebar, it's `settings.sidebarDelay` (default 150ms).

## Implementation order

1. **sidebar-expand-on-hover**: Rewrite `setEvents` with coordinate-based mousemove. Remove hover flags, rootSplit handler, sidebar mouseenter/mouseleave. Keep ribbon/resize triggers and pin toggles.
2. **quick-peek-sidebar**: Rewrite `onLayoutReady` rootSplit handler and `attachManualEvents` leave handlers. Remove trigger zone element. Keep ribbon/container mouseenter for CSS class and expand trigger. Replace leave handlers with coordinate-based collapse.
3. Build and test both.
4. Amend commits, force-push, rerelease.
