/* eslint-disable obsidianmd/ui/sentence-case */
import { App, PluginSettingTab, Setting, DropdownComponent } from "obsidian";
import VoxTrackPlugin from "../main";
import { t } from "../i18n/translations";

export interface VoxTrackSettings {
    voice: string;
    volume: string;
    autoScrollMode: 'off' | 'center' | 'cursor';
    highlightMode: 'word' | 'sentence' | 'none';
    clickToPlay: boolean;
    filterCode: boolean;
    filterLinks: boolean;
    filterMath: boolean;
    filterFrontmatter: boolean;
    filterObsidian: boolean;
    playbackSpeed: number;
    highlightColor: string;
}

export const DEFAULT_SETTINGS: VoxTrackSettings = {
    voice: "zh-CN-XiaoxiaoNeural",
    volume: "+0%",
    playbackSpeed: 1.0,
    highlightColor: 'yellow',
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
            .setName(t("Voice options"))
            .setHeading();

        new Setting(containerEl)
            .setName(t("Voice role"))
            .setDesc(t("Voice role desc"))
            .addDropdown((dropdown: DropdownComponent) => 
                dropdown
                .addOption('zh-CN-XiaoxiaoNeural', 'Xiaoxiao (Female, CN)')
                .addOption('zh-CN-YunxiNeural', 'Yunxi (Male, CN)')
                .addOption('zh-CN-YunjianNeural', 'Yunjian (Male, CN)')
                .addOption('zh-HK-HiuMaanNeural', 'HiuMaan (Female, HK)')
                .addOption('zh-TW-HsiaoChenNeural', 'HsiaoChen (Female, TW)')
                .addOption('en-US-AvaNeural', 'Ava (Female, US)')
                .addOption('en-US-AndrewNeural', 'Andrew (Male, US)')
                .addOption('en-GB-SoniaNeural', 'Sonia (Female, UK)')
                .setValue(this.plugin.settings.voice)
                .onChange(async (value) => {
                    this.plugin.settings.voice = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName(t("Playback speed"))
            .setDesc(t("Playback speed desc"))
            .addSlider(slider => slider
                .setLimits(0.5, 3.0, 0.1)
                .setValue(this.plugin.settings.playbackSpeed)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.playbackSpeed = value;
                    this.plugin.setPlaybackSpeed(value); // Live update
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t("Text filters"))
            .setHeading();

        new Setting(containerEl)
            .setName(t("Filter frontmatter"))
            .setDesc(t("Filter frontmatter desc"))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.filterFrontmatter)
                .onChange(async (value) => {
                    this.plugin.settings.filterFrontmatter = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t("Filter code blocks"))
            .setDesc(t("Filter code blocks desc"))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.filterCode)
                .onChange(async (value) => {
                    this.plugin.settings.filterCode = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t("Filter links"))
            .setDesc(t("Filter links desc"))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.filterLinks)
                .onChange(async (value) => {
                    this.plugin.settings.filterLinks = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t("Filter math"))
            .setDesc(t("Filter math desc"))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.filterMath)
                .onChange(async (value) => {
                    this.plugin.settings.filterMath = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t("Filter Obsidian"))
            .setDesc(t("Filter Obsidian desc"))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.filterObsidian)
                .onChange(async (value) => {
                    this.plugin.settings.filterObsidian = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t("Interaction"))
            .setHeading();

        new Setting(containerEl)
            .setName(t("Auto scroll mode"))
            .setDesc(t("Auto scroll mode desc"))
            .addDropdown(dropdown => dropdown
                .addOption('off', t("Auto scroll: Off"))
                .addOption('center', t("Auto scroll: Center"))
                .addOption('cursor', t("Auto scroll: Cursor"))
                .setValue(this.plugin.settings.autoScrollMode)
                .onChange(async (value) => {
                    this.plugin.settings.autoScrollMode = value as 'off' | 'center' | 'cursor';
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t("Highlight mode"))
            .setDesc(t("Highlight mode desc"))
            .addDropdown(dropdown => dropdown
                .addOption('word', t("Highlight mode: Word"))
                .addOption('sentence', t("Highlight mode: Sentence"))
                .addOption('none', t("Highlight mode: None"))
                .setValue(this.plugin.settings.highlightMode)
                .onChange(async (value) => {
                    this.plugin.settings.highlightMode = value as 'word' | 'sentence' | 'none';
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t("Highlight color"))
            .setDesc(t("Highlight color desc"))
            .addDropdown(dropdown => dropdown
                .addOption('yellow', t("Color: Yellow"))
                .addOption('green', t("Color: Green"))
                .addOption('blue', t("Color: Blue"))
                .addOption('purple', t("Color: Purple"))
                .addOption('red', t("Color: Red"))
                .addOption('none', t("Color: Default"))
                .setValue(this.plugin.settings.highlightColor)
                .onChange(async (value) => {
                    this.plugin.settings.highlightColor = value;
                    this.plugin.applyHighlightColor(); // Dynamic update
                    await this.plugin.saveSettings();
                }));
    }
}
