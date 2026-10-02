// src/config.js
// Configuration manager with persistent global storage.
// English comments only.

const fs = require('fs');
const path = require('path');
const os = require('os');

class ConfigManager {
    constructor() {
        const homeDir = os.homedir();
        this.globalConfigDir = path.join(homeDir, '.gemini', 'config');
        this.globalConfigFile = path.join(this.globalConfigDir, 'notifier.json');
        this.localConfigFile = path.join(__dirname, '..', 'config.json');
        this.agyConfigFile = path.join('D:', '1AWDWJ', 'Anti', 'AGY', 'config.json');

        this.cachedConfig = null;
    }

    ensureDirExists(dir) {
        try {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        } catch (e) {}
    }

    load() {
        // 1. Try global user configuration file (~/.gemini/config/notifier.json)
        if (fs.existsSync(this.globalConfigFile)) {
            try {
                const content = fs.readFileSync(this.globalConfigFile, 'utf8');
                this.cachedConfig = JSON.parse(content);
                return this.cachedConfig;
            } catch (e) {}
        }

        // 2. Try local project configuration file
        if (fs.existsSync(this.localConfigFile)) {
            try {
                const content = fs.readFileSync(this.localConfigFile, 'utf8');
                this.cachedConfig = JSON.parse(content);
                return this.cachedConfig;
            } catch (e) {}
        }

        // 3. Fallback: inherit pushUrl from AGY project if available
        let inheritedPushUrl = '';
        let inheritedEnabled = true;
        if (fs.existsSync(this.agyConfigFile)) {
            try {
                const content = fs.readFileSync(this.agyConfigFile, 'utf8');
                const agyCfg = JSON.parse(content);
                if (agyCfg && agyCfg.pushNotificationUrl) {
                    inheritedPushUrl = agyCfg.pushNotificationUrl;
                    inheritedEnabled = agyCfg.pushNotificationEnabled !== false;
                }
            } catch (e) {}
        }

        this.cachedConfig = {
            enabled: inheritedEnabled,
            pushUrl: inheritedPushUrl,
            autoApprovePlan: false,
            pollIntervalMs: 1500,
            idlePollIntervalMs: 4000
        };

        // Persist initial configuration to global config file
        this.save(this.cachedConfig);
        return this.cachedConfig;
    }

    save(newConfig) {
        this.ensureDirExists(this.globalConfigDir);
        this.cachedConfig = Object.assign({}, this.cachedConfig || {}, newConfig);
        try {
            fs.writeFileSync(this.globalConfigFile, JSON.stringify(this.cachedConfig, null, 2), 'utf8');
            return true;
        } catch (e) {
            console.error('Failed to save notifier configuration:', e.message);
            return false;
        }
    }

    getSettings() {
        if (!this.cachedConfig) {
            this.load();
        }
        return Object.assign({}, this.cachedConfig);
    }

    updateSettings(payload) {
        const cur = this.getSettings();
        if (payload.enabled !== undefined) cur.enabled = Boolean(payload.enabled);
        if (payload.pushUrl !== undefined) cur.pushUrl = String(payload.pushUrl).trim();
        if (payload.autoApprovePlan !== undefined) cur.autoApprovePlan = Boolean(payload.autoApprovePlan);
        this.save(cur);
        return cur;
    }
}

module.exports = {
    ConfigManager,
    configManager: new ConfigManager()
};
