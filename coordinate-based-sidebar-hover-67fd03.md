# Coordinate-based sidebar hover architecture

Replace all mouseenter/mouseleave/elementFromPoint sidebar detection with a single `document.mousemove` handler that uses coordinate math to drive both expand and collapse. Pin is toggled via the sidebar toggle buttons.

## Key discovery

Obsidian stores `leftSplit.size` and `rightSplit.size` (e.g. 325) even when sidebars are collapsed (`display: none; width: 0px`). Combined with `leftRibbon.containerEl.getBoundingClientRect().right` (44px) and `workspace.containerEl.clientWidth` (full window), we can define stable rectangular regions that never depend on sidebar DOM state.

## Region definitions

```
|  ribbon  |     left sidebar region     |        editor        |    right sidebar region    |
0         44                            369                   1027                          1352
           ribbonRight              ribbonRight+leftSize   wsWidth-rightSize            wsWidth
```

The right ribbon is empty (0px wide) in standard Obsidian and plays no role.

## Architecture (shared by both plugins)

### Single mousemove handler (rAF-throttled)

One `document.mousemove` listener, gated by `requestAnimationFrame` for perf:

```
document mousemove (rAF-throttled):
  guard: skip if event.target outside workspace.containerEl  (generic overlay guard)

  compute:
    ribbonRight    = leftRibbon.containerEl.getBoundingClientRect().right
    leftSize       = leftSplit.size
    rightSize      = rightSplit.size
    wsWidth        = workspace.containerEl.clientWidth
    x              = event.clientX

  LEFT:
    inRibbon     = x < ribbonRight
    inLeftRegion = x < ribbonRight + leftSize
    if inRibbon AND left collapsed AND not pinned -> expand left
    if !inLeftRegion AND left expanded AND not pinned -> schedule collapse left

  RIGHT:
    inRightTrigger = x > wsWidth - RIGHT_EDGE_TRIGGER_PX
    inRightRegion  = x > wsWidth - rightSize
    if inRightTrigger AND right collapsed AND not pinned -> expand right
    if !inRightRegion AND right expanded AND not pinned -> schedule collapse right
```

**Left expand trigger is ribbon-only** (`x < ribbonRight`, ~44px) -- matches original behavior. Once expanded, the full left region keeps it open. Collapse fires when mouse leaves the full left region.

**Right expand trigger is edge proximity** (`x > wsWidth - 20px`) -- right ribbon doesn't exist. Once expanded, the full right region keeps it open.

### Overlay guard (generic)

Obsidian appends all overlays (modals, menus, suggestion popups, tooltips, context menus, etc.) to `document.body` outside `workspace.containerEl`. When the mouse is over any overlay, `event.target` is not inside the workspace:

```ts
if (!this.app.workspace.containerEl.contains(event.target as Node)) return;
```

- **Generic**: handles every overlay type, current and future, no class names
- **Free**: `event.target` is already on the event; `contains()` is a single DOM tree walk
- Replaces `isModalOrMenuOpen()` entirely

### Pin via sidebar toggle buttons

The sidebar toggle buttons (`.sidebar-toggle-button.mod-left` / `.mod-right`) are the natural pin trigger -- visible on both sides, discoverable, already associated with sidebar state in the user's mental model.

Intercept click on these buttons: `preventDefault` + `stopPropagation` to suppress Obsidian's default toggle, then toggle `leftPin` / `rightPin` instead. Since the plugin controls expand/collapse, the default toggle is redundant.

```ts
const leftToggle = document.querySelector('.sidebar-toggle-button.mod-left');
this.registerDomEvent(leftToggle, 'click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (this.settings.leftSideEnabled) {
    this.settings.leftPin = !this.settings.leftPin;
    this.saveSettings();
  }
});
```

Same pattern for `.mod-right`. Replaces dblclick-on-ribbon for left, and provides a working pin trigger for right (which had no working trigger before).

### Collapse delay handling

1. When mouse leaves a region, start a collapse timer
2. If mouse re-enters the region before the timer fires, cancel it
3. Timer callback re-checks region before collapsing

```ts
private collapseLeftTimer: number | null = null;

// On leaving left region:
if (!inLeftRegion && !leftSplit.collapsed && !pinned) {
  if (!this.collapseLeftTimer) {
    this.collapseLeftTimer = window.setTimeout(() => {
      this.collapseLeftTimer = null;
      if (this.currentRegion !== 'left') {
        this.collapseSidebar(this.leftSidebar);
      }
    }, this.settings.sidebarDelay ?? 0);
  }
}
// On entering left region:
if (inLeftRegion && this.collapseLeftTimer) {
  clearTimeout(this.collapseLeftTimer);
  this.collapseLeftTimer = null;
}
```

For expand-on-hover, collapse delay is 0 (instant). For quick-peek-sidebar, it's `settings.sidebarDelay` (default 150ms).

### What gets removed

- All `mouseenter`/`mouseleave` handlers on sidebar containers, ribbons, and rootSplit
- All hover tracking flags (`isHoveringLeftRegion`, `isHoveringRightRegion`, `isHoveringLeft`, `isHoveringRight`, `isRightEdgeHovering`)
- All `elementFromPoint` calls
- All CSS selector matching on `relatedTarget` / `event.target`
- `isModalOrMenuOpen()` method (hardcoded `.modal-container` / `.menu`)
- Right ribbon references (it has no width and no icons)
- The right trigger zone DOM element (quick-peek-sidebar) -- coordinate check replaces it
- Ribbon dblclick pin handler -- toggle button click replaces it

### What stays

- **Resize handle mouseenter** -- saves sidebar width to settings on drag start
- **document mouseleave** -- collapse both when cursor exits window
- **document click** handler (quick-peek-sidebar)
- **layout-change** handler (quick-peek-sidebar)
- All settings, hotkey commands, CSS variables, overlay mode

## Plugin-specific changes

### sidebar-expand-on-hover

**setEvents rewrite:**

```
document mousemove (rAF-throttled):
  [unified expand + collapse logic above]
resize handle mouseenter -> save size to settings (expand is handled by mousemove)
document mouseleave -> collapse both
.sidebar-toggle-button.mod-left click -> toggle leftPin
.sidebar-toggle-button.mod-right click -> toggle rightPin
```

**Remove entirely:**
- Ribbon mouseenter expand handlers (left and right)
- Ribbon dblclick pin handlers
- rootSplit mouseenter collapse handler
- All sidebar/ribbon mouseenter/mouseleave hover tracking
- `isHoveringLeftRegion`, `isHoveringRightRegion`, `isRightEdgeHovering` flags
- `isModalOrMenuOpen()` method
- All right ribbon references

### quick-peek-sidebar

**onLayoutReady rewrite:**

```
document mousemove (rAF-throttled):
  [unified expand + collapse logic above]
  skip if onlyWhenFocused && !document.hasFocus()
document mouseleave -> collapse both
document click -> collapse on editor click
.sidebar-toggle-button.mod-left click -> toggle leftPin
.sidebar-toggle-button.mod-right click -> toggle rightPin
```

**attachManualEvents rewrite:**

Keep:
- Resize handle mouseenter triggers (save size)

Remove:
- leftRibbonMouseEnterHandler (mousemove handles expand)
- leftSplit/rightSplit containerEl mouseenter/mouseleave handlers
- leftSplitMouseLeaveHandler / rightSplitMouseLeaveHandler
- rootSplit mouseenter handler
- Right trigger zone DOM element

**The `hovered` CSS class**: toggle inside `expandSidebar()` / `collapseSidebar()` instead of on mouseenter/mouseleave.

## Implementation order

1. **sidebar-expand-on-hover**: Rewrite `setEvents` with unified coordinate-based mousemove. Remove all hover flags, hover handlers, rootSplit handler, ribbon dblclick. Add toggle button click handlers. Keep resize handle and document mouseleave.
2. **quick-peek-sidebar**: Same mousemove rewrite. Remove trigger zone element, all container mouseenter/mouseleave, ribbon handlers. Add toggle button click handlers. Move `hovered` class management into expand/collapse methods.
3. Build and test both.
4. Amend commits, force-push, rerelease.
