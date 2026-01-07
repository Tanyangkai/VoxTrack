import { App, PluginSettingTab, Setting } from "obsidian";
import VoxTrackPlugin from "../main";

export interface VoxTrackSettings {
    voice: string;
    rate: string;
    pitch: string;
    volume: string;
    autoScrollMode: 'off' | 'center' | 'cursor';
    highlightMode: 'word' | 'sentence' | 'none';
    clickToPlay: boolean;
    filterCode: boolean;
    filterLinks: boolean;
    filterMath: boolean;
    filterFrontmatter: boolean;
    filterObsidian: boolean;
}

export const DEFAULT_SETTINGS: VoxTrackSettings = {
    voice: "zh-CN-XiaoxiaoNeural",
    rate: "+0%",
    pitch: "+0Hz",
    volume: "+0%",
    autoScrollMode: 'cursor', // Default to cursor for best Live Preview support
    highlightMode: 'word',
    clickToPlay: false,
    filterCode: true,
    filterLinks: true,
    filterMath: true,
    filterFrontmatter: true,
    filterObsidian: true
};

export class VoxTrackSettingTab extends PluginSettingTab {
    plugin: VoxTrackPlugin;

    constructor(app: App, plugin: VoxTrackPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName('Voice options')
            .setHeading();

        new Setting(containerEl)
            .setName('Voice role')
            .setDesc('Select the capability of the speaker (e.g. Xiaoxiao, Yunxi)')
            .addText(text => text
                .setPlaceholder('zh-CN-XiaoxiaoNeural')
                .setValue(this.plugin.settings.voice)
                .onChange(async (value) => {
                    this.plugin.settings.voice = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Speech rate')
            .setDesc('Speech rate (e.g. +0%)')
            .addText(text => text
                .setPlaceholder('+0%')
                .setValue(this.plugin.settings.rate)
                .onChange(async (value) => {
                    this.plugin.settings.rate = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Speech pitch')
            .setDesc('Speech pitch (e.g. +0Hz)')
            .addText(text => text
                .setPlaceholder('+0Hz')
                .setValue(this.plugin.settings.pitch)
                .onChange(async (value) => {
                    this.plugin.settings.pitch = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Text filters')
            .setHeading();

        new Setting(containerEl)
            .setName('Filter frontmatter')
            .setDesc('Skip YAML frontmatter at the beginning of the note')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.filterFrontmatter)
                .onChange(async (value) => {
                    this.plugin.settings.filterFrontmatter = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Filter code blocks')
            .setDesc('Skip code blocks and inline code')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.filterCode)
                .onChange(async (value) => {
                    this.plugin.settings.filterCode = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Filter links')
            .setDesc('Read link caption only, skip URL')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.filterLinks)
                .onChange(async (value) => {
                    this.plugin.settings.filterLinks = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Filter math')
            .setDesc('Skip LaTeX math equations')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.filterMath)
                .onChange(async (value) => {
                    this.plugin.settings.filterMath = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Filter Obsidian syntax')
            .setDesc('Skip callouts, comments, and other metadata')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.filterObsidian)
                .onChange(async (value) => {
                    this.plugin.settings.filterObsidian = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Interaction')
            .setHeading();

        new Setting(containerEl)
            .setName('Auto scroll mode')
            .setDesc('How the editor should follow the speech')
            .addDropdown(dropdown => dropdown
                .addOption('off', 'Off')
                .addOption('center', 'Scroll only (Keep cursor)')
                .addOption('cursor', 'Scroll & Move Cursor (Recommended for LP Tables)')
                .setValue(this.plugin.settings.autoScrollMode)
                .onChange(async (value) => {
                    this.plugin.settings.autoScrollMode = value as any;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Highlight mode')
            .setDesc('Visual tracking granularity')
            .addDropdown(dropdown => dropdown
                .addOption('word', 'Word level')
                .addOption('sentence', 'Sentence level')
                .addOption('none', 'None')
                .setValue(this.plugin.settings.highlightMode)
                .onChange(async (value) => {
                    this.plugin.settings.highlightMode = value as any;
                    await this.plugin.saveSettings();
                }));
    }
}
