
export class App { }
export class Plugin {
    app: App;
    manifest: any;
    constructor(app: App, manifest: any) {
        this.app = app;
        this.manifest = manifest;
    }
    async loadSettings() { }
    async saveSettings() { }
    addSettingTab() { }
    addCommand() { }
    registerEditorExtension() { }
    addStatusBarItem() {
        return {
            createSpan: () => ({ onclick: null }),
            addClass: () => { },
            remove: () => { }
        };
    }
    addRibbonIcon() { }
    registerEvent() { }
}
export class PluginSettingTab {
    app: App;
    plugin: Plugin;
    containerEl: HTMLElement;
    constructor(app: App, plugin: Plugin) {
        this.app = app;
        this.plugin = plugin;
        this.containerEl = document.createElement('div');
    }
    display() { }
    hide() { }
}
export class Setting {
    constructor(containerEl: HTMLElement) { }
    setName() { return this; }
    setDesc() { return this; }
    addDropdown() { return this; }
    addText() { return this; }
    addToggle() { return this; }
    addSlider() { return this; }
}
export class Notice {
    constructor(message: string) { }
}
export function setIcon() { }
export class MarkdownView { }
export class Editor { }
export const moment = {
    locale: () => 'en'
};
