import { App, PluginSettingTab, Setting } from "obsidian";
import VoxTrackPlugin from "../main";

export interface VoxTrackSettings {
    voice: string;
    rate: string;
    pitch: string;
    volume: string;
    autoScroll: boolean;
    highlightMode: 'word' | 'sentence' | 'none';
    clickToPlay: boolean;
}

export const DEFAULT_SETTINGS: VoxTrackSettings = {
    voice: "zh-CN-XiaoxiaoNeural",
    rate: "+0%",
    pitch: "+0Hz",
    volume: "+0%",
    autoScroll: true,
    highlightMode: 'word',
    clickToPlay: false
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
            .setName('Interaction')
            .setHeading();

        new Setting(containerEl)
            .setName('Auto scroll')
            .setDesc('Automatically scroll the editor to follow the speech')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoScroll)
                .onChange(async (value) => {
                    this.plugin.settings.autoScroll = value;
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
