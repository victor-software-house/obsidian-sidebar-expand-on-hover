import { App, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
interface SidebarExpandOnHoverSettings {
  leftSidebarWidth: number;
  rightSidebarWidth: number;
  leftPin: boolean;
  rightPin: boolean;
  leftSideEnabled: boolean;
  rightSideEnabled: boolean;
}

const DEFAULT_SETTINGS: SidebarExpandOnHoverSettings = {
  leftSidebarWidth: 325,
  rightSidebarWidth: 325,
  leftPin: false,
  rightPin: false,
  leftSideEnabled: true,
  rightSideEnabled: true,
};

export default class SidebarExpandOnHoverPlugin extends Plugin {
  settings: SidebarExpandOnHoverSettings;
  leftRibbon: HTMLElement;
  rightRibbon?: HTMLElement;
  leftSidebar: HTMLElement;
  rightSidebar: HTMLElement;
  isRightEdgeHovering = false;

  // Hover tracking flags — set by mouseenter/mouseleave on the actual
  // container elements. These are stable across child-element transitions
  // (mouseenter/mouseleave don't fire when moving between children).
  private isHoveringLeftRegion = false;
  private isHoveringRightRegion = false;

  private readonly RIGHT_EDGE_TRIGGER_PX = 20;

  async onload() {
    // Initialize and set events when layout is fully ready
    this.app.workspace.onLayoutReady(() => {
      this.loadSettings().then(() => {
        this.initialize();
        this.setEvents();
        this.addSettingTab(new SidebarExpandOnHoverSettingTab(this.app, this));
        // This timeout is needed to override Obsidian sidebar state at launch
        setTimeout(() => {
          if (this.settings.leftPin) {
            this.expandSidebar(this.leftSidebar);
          } else {
            this.collapseSidebar(this.leftSidebar);
          }
          if (this.settings.rightPin) {
            this.expandSidebar(this.rightSidebar);
          } else {
            this.collapseSidebar(this.rightSidebar);
          }
        }, 200);
      });
    });

    this.addCommand({
      id: 'Toggle-Left-Sidebar-Expand-On-Hover',
      name: 'Toggle Left Sidebar Behavior',
      callback: () => {
        this.settings.leftSideEnabled = !this.settings.leftSideEnabled;
        if (this.settings.leftSideEnabled == false)
          this.settings.leftPin = false;
        this.saveSettings();
        if (this.settings.leftSideEnabled) {
          new Notice('Left Sidebar Expand on Hover Enabled');
        } else {
          new Notice('Left Sidebar Expand on Hover disabled');
        }
      },
    });

    this.addCommand({
      id: 'Toggle-Right-Sidebar-Expand-On-Hover',
      name: 'Toggle Right Sidebar Behavior',
      callback: () => {
        this.settings.rightSideEnabled = !this.settings.rightSideEnabled;
        if (this.settings.rightSideEnabled == false)
          this.settings.rightPin = false;
        this.saveSettings();
        if (this.settings.rightSideEnabled) {
          new Notice('Right Sidebar Expand on Hover Enabled');
        } else {
          new Notice('Right Sidebar Expand on Hover disabled');
        }
      },
    });
  }

  // Initializes the variables to store DOM HTML elements
  initialize: Function = () => {
    this.leftRibbon = (this.app.workspace.leftRibbon as any).containerEl;
    this.rightRibbon = (this.app.workspace.rightRibbon as any)?.containerEl;
    this.leftSidebar = ((this.app.workspace
      .leftSplit as unknown) as any).containerEl;
    this.rightSidebar = ((this.app.workspace
      .rightSplit as unknown) as any).containerEl;
  };

  isModalOrMenuOpen = (): boolean => {
    const hasModal = document.querySelector('.modal-container') !== null;
    const hasMenu = document.querySelector('.menu') !== null;
    return hasModal || hasMenu;
  };

  // Adds event listeners to the HTML elements
  setEvents: Function = () => {
    // ── Hover tracking ──────────────────────────────────────────────
    // mouseenter/mouseleave on a container are stable: they do NOT fire
    // when moving between children (tab buttons, gaps, icons, etc.).
    // We track both the sidebar split and its ribbon as one "region".

    this.registerDomEvent(this.leftSidebar, 'mouseenter', () => {
      this.isHoveringLeftRegion = true;
    });
    this.registerDomEvent(this.leftSidebar, 'mouseleave', () => {
      this.isHoveringLeftRegion = false;
    });
    this.registerDomEvent(this.leftRibbon, 'mouseenter', () => {
      this.isHoveringLeftRegion = true;
    });
    this.registerDomEvent(this.leftRibbon, 'mouseleave', () => {
      this.isHoveringLeftRegion = false;
    });

    this.registerDomEvent(this.rightSidebar, 'mouseenter', () => {
      this.isHoveringRightRegion = true;
    });
    this.registerDomEvent(this.rightSidebar, 'mouseleave', () => {
      this.isHoveringRightRegion = false;
    });
    if (this.rightRibbon) {
      this.registerDomEvent(this.rightRibbon, 'mouseenter', () => {
        this.isHoveringRightRegion = true;
      });
      this.registerDomEvent(this.rightRibbon, 'mouseleave', () => {
        this.isHoveringRightRegion = false;
      });
    }

    // ── Expand triggers ─────────────────────────────────────────────

    this.registerDomEvent(this.leftRibbon, 'mouseenter', () => {
      if (!this.settings.leftPin) {
        this.expandSidebar(this.leftSidebar);
      }
    });

    if (this.rightRibbon) {
      this.registerDomEvent(this.rightRibbon, 'mouseenter', () => {
        if (!this.settings.rightPin) {
          this.expandSidebar(this.rightSidebar);
        }
      });
    }

    this.registerDomEvent(
      (this.app.workspace.leftSplit as any).resizeHandleEl,
      'mouseenter',
      () => {
        if (!this.settings.leftPin) {
          this.expandSidebar(this.leftSidebar);
        }
        this.settings.leftSidebarWidth = Number(
          (this.app.workspace.leftSplit as any).size
        );
        this.saveSettings();
      }
    );
    this.registerDomEvent(
      (this.app.workspace.rightSplit as any).resizeHandleEl,
      'mouseenter',
      () => {
        if (!this.settings.rightPin) {
          this.expandSidebar(this.rightSidebar);
        }
        this.settings.rightSidebarWidth = Number(
          (this.app.workspace.rightSplit as any).size
        );
        this.saveSettings();
      }
    );

    // Right-edge mousemove trigger (right sidebar has no always-visible
    // ribbon, so we detect proximity to the right edge of the workspace).
    this.registerDomEvent(document, 'mousemove', (event: MouseEvent) => {
      if (this.settings.rightPin || !this.settings.rightSideEnabled) {
        this.isRightEdgeHovering = false;
        return;
      }

      if (this.isModalOrMenuOpen()) {
        this.isRightEdgeHovering = false;
        return;
      }

      const mouseX = event.clientX;
      const editorWidth = this.app.workspace.containerEl.clientWidth;
      const isNearRightEdge =
        mouseX >= editorWidth - this.RIGHT_EDGE_TRIGGER_PX;

      if (isNearRightEdge) {
        this.isRightEdgeHovering = true;
        this.expandSidebar(this.rightSidebar);
        return;
      }

      if (this.isRightEdgeHovering) {
        this.isRightEdgeHovering = false;
        if (!this.isHoveringRightRegion) {
          this.collapseSidebar(this.rightSidebar);
        }
      }
    });

    // ── Collapse triggers ───────────────────────────────────────────

    this.registerDomEvent(
      (this.app.workspace.rootSplit as any).containerEl,
      'mouseenter',
      () => {
        if (!this.isHoveringLeftRegion) {
          this.collapseSidebar(this.leftSidebar);
        }
        if (!this.isHoveringRightRegion) {
          this.isRightEdgeHovering = false;
          this.collapseSidebar(this.rightSidebar);
        }
      }
    );

    this.registerDomEvent(document, 'mouseleave', () => {
      this.collapseSidebar(this.leftSidebar);
      this.collapseSidebar(this.rightSidebar);
    });

    // ── Pin toggles ─────────────────────────────────────────────────

    this.registerDomEvent(this.leftRibbon, 'dblclick', () => {
      if (this.settings.leftSideEnabled) {
        this.settings.leftPin = !this.settings.leftPin;
        this.saveSettings();
      }
    });

    if (this.rightRibbon) {
      this.registerDomEvent(this.rightRibbon, 'dblclick', () => {
        if (this.settings.rightSideEnabled) {
          this.settings.rightPin = !this.settings.rightPin;
          this.saveSettings();
        }
      });
    }
  };

  // Changes sidebar style width and display to expand it
  expandSidebar = (sidebar: HTMLElement) => {
    if (sidebar == this.leftSidebar && this.settings.leftSideEnabled) {
      (this.app.workspace.leftSplit as any).setSize(
        this.settings.leftSidebarWidth
      );
      (this.app.workspace.leftSplit as any).expand();
    }
    if (sidebar == this.rightSidebar && this.settings.rightSideEnabled) {
      (this.app.workspace.rightSplit as any).setSize(
        this.settings.rightSidebarWidth
      );
      (this.app.workspace.rightSplit as any).expand();
    }
  };

  // Changes sidebar style width to collapse it
  collapseSidebar = (sidebar: HTMLElement) => {
    if (
      sidebar == this.leftSidebar &&
      !this.settings.leftPin &&
      this.settings.leftSideEnabled
    ) {
      (this.app.workspace.leftSplit as any).collapse();
    }
    if (
      sidebar == this.rightSidebar &&
      !this.settings.rightPin &&
      this.settings.rightSideEnabled
    ) {
      (this.app.workspace.rightSplit as any).collapse();
    }
  };

  onunload() {
    this.saveSettings();
  }

  async loadSettings() {
    this.settings = Object.assign(DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

// Plugin settings
class SidebarExpandOnHoverSettingTab extends PluginSettingTab {
  plugin: SidebarExpandOnHoverPlugin;

  constructor(app: App, plugin: SidebarExpandOnHoverPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    this.plugin.loadData();
    containerEl.createEl('h2', { text: 'Sidebar Expand On Hover' });
    containerEl.createEl('p', {
      text: `Note: You can also double click on each of the ribbons to 'pin' the corresponding 
      sidebar so that it remains expanded.
      You can undo this 'pinned state' behavior by double clicking on the ribbons again.
      This only works when you have that sidebar 'enabled' in this settings. Enjoy! :D`,
    });

    containerEl.createEl('h4', { text: 'Enable Individual Sidebar' });
    const leftSideEnabled = new Setting(containerEl);
    leftSideEnabled.setName('Left Sidebar');
    leftSideEnabled.setDesc(
      'Toggle to enable/disable left sidebar expand on hover'
    );
    leftSideEnabled.addToggle((t) => {
      t.setValue(this.plugin.settings.leftSideEnabled);
      t.onChange(async (v) => {
        this.plugin.settings.leftSideEnabled = v;
        if (v == false) this.plugin.settings.leftPin = false;
        this.plugin.saveSettings();
      });
    });

    const rightSideEnabled = new Setting(containerEl);
    rightSideEnabled.setName('Right Sidebar');
    rightSideEnabled.setDesc(
      'Toggle to enable/disable right sidebar expand on hover'
    );
    rightSideEnabled.addToggle((t) => {
      t.setValue(this.plugin.settings.rightSideEnabled);
      t.onChange(async (v) => {
        this.plugin.settings.rightSideEnabled = v;
        if (v == false) this.plugin.settings.rightPin = false;
        this.plugin.saveSettings();
      });
    });

    containerEl.createEl('h4', { text: 'Sidebar Expand Width' });
    const leftSidebarWidth = new Setting(containerEl);
    leftSidebarWidth.setName('Left Sidebar');
    leftSidebarWidth.setDesc('Set the width of left sidebar in pixel unit');
    leftSidebarWidth.addText((t) => {
      t.setValue(String(this.plugin.settings.leftSidebarWidth));
      t.setPlaceholder('Default: 325').onChange(async (value) => {
        this.plugin.settings.leftSidebarWidth = Number(value);
        (this.app.workspace.leftSplit as any).setSize(
          this.plugin.settings.leftSidebarWidth
        );
        this.plugin.saveSettings();
      });
    });

    const rightSidebarWidth = new Setting(containerEl);
    rightSidebarWidth.setName('Right Sidebar');
    rightSidebarWidth.setDesc('Set the width of right sidebar in pixel unit');
    rightSidebarWidth.addText((t) => {
      t.setValue(String(this.plugin.settings.rightSidebarWidth));
      t.setPlaceholder('Default: 325').onChange(async (value) => {
        this.plugin.settings.rightSidebarWidth = Number(value);
        (this.app.workspace.rightSplit as any).setSize(
          this.plugin.settings.rightSidebarWidth
        );
        this.plugin.saveSettings();
      });
    });
  }
}
