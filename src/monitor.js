// src/monitor.js
// Lightweight Antigravity CDP observer using native WebSocket and HTTP.
// Zero third-party dependencies.
// English comments only.

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const FALLBACK_PORTS = [5743, 9222, 9229, 9333, 9223];

function httpGetJson(url, timeoutMs = 2000) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const req = http.request({
            hostname: u.hostname,
            port: u.port,
            path: u.pathname + u.search,
            method: 'GET',
            timeout: timeoutMs
        }, res => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
        });
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('HTTP request timed out'));
        });
        req.on('error', reject);
        req.end();
    });
}

class AntigravityMonitor {
    /**
     * @param {Object} options
     * @param {NotificationService} options.service
     * @param {ConfigManager} options.configManager
     * @param {Function} [options.onStatusChange]
     */
    constructor(options = {}) {
        this.service = options.service;
        this.configManager = options.configManager;
        this.onStatusChange = typeof options.onStatusChange === 'function' ? options.onStatusChange : null;

        this.isRunning = false;
        this.isConnected = false;
        this.activePort = null;
        this.wsClient = null;
        this.pollTimer = null;
        this.requestId = 1;
        this.pendingRequests = new Map();

        this.currentConvId = null;
        this.currentConvTitle = '';
        this.currentProjectName = '';
        this.lastObservedWorking = false;
    }

    findCandidatePorts() {
        const candidatePorts = [];

        // 1. Scan DevToolsActivePort in user roaming appdata
        const candidatePaths = [];
        if (process.env.APPDATA) {
            candidatePaths.push(path.join(process.env.APPDATA, 'Antigravity', 'DevToolsActivePort'));
        }
        if (process.env.USERPROFILE) {
            candidatePaths.push(path.join(process.env.USERPROFILE, 'AppData', 'Roaming', 'Antigravity', 'DevToolsActivePort'));
        }
        try {
            const usersDir = 'C:\\Users';
            if (fs.existsSync(usersDir)) {
                for (const u of fs.readdirSync(usersDir)) {
                    const p = path.join(usersDir, u, 'AppData', 'Roaming', 'Antigravity', 'DevToolsActivePort');
                    if (!candidatePaths.includes(p)) candidatePaths.push(p);
                }
            }
        } catch (e) {}

        for (const p of candidatePaths) {
            try {
                if (fs.existsSync(p)) {
                    const content = fs.readFileSync(p, 'utf8');
                    const portStr = content.split('\n')[0].trim();
                    const portNum = parseInt(portStr, 10);
                    if (portNum > 0 && !candidatePorts.includes(portNum)) {
                        candidatePorts.push(portNum);
                    }
                }
            } catch (e) {}
        }

        // 2. Add standard fallback ports
        for (const p of FALLBACK_PORTS) {
            if (!candidatePorts.includes(p)) {
                candidatePorts.push(p);
            }
        }

        return candidatePorts;
    }

    async discoverTarget() {
        const ports = this.findCandidatePorts();
        for (const port of ports) {
            try {
                const list = await httpGetJson(`http://127.0.0.1:${port}/json/list`, 1000);
                if (Array.isArray(list)) {
                    const target = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
                    if (target) {
                        return { port, target };
                    }
                }
            } catch (e) {}
        }
        return null;
    }

    sendCdpCommand(method, params = {}) {
        return new Promise((resolve, reject) => {
            if (!this.wsClient || this.wsClient.readyState !== 1) {
                return reject(new Error('CDP WebSocket not connected'));
            }
            const id = this.requestId++;
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`CDP command ${method} timed out`));
            }, 5000);

            this.pendingRequests.set(id, { resolve, reject, timeout });
            this.wsClient.send(JSON.stringify({ id, method, params }));
        });
    }

    async evaluateInPage(expression) {
        try {
            const res = await this.sendCdpCommand('Runtime.evaluate', {
                expression,
                returnByValue: true,
                awaitPromise: true
            });
            if (res && res.result && res.result.value !== undefined) {
                return res.result.value;
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    async connect() {
        const discovery = await this.discoverTarget();
        if (!discovery) {
            return false;
        }

        const { port, target } = discovery;
        this.activePort = port;

        return new Promise((resolve) => {
            try {
                const ws = new WebSocket(target.webSocketDebuggerUrl);
                this.wsClient = ws;

                ws.onopen = async () => {
                    this.isConnected = true;
                    if (this.onStatusChange) {
                        this.onStatusChange({ connected: true, port, targetUrl: target.url });
                    }
                    try {
                        await this.sendCdpCommand('Runtime.enable');
                    } catch (e) {}
                    resolve(true);
                };

                ws.onmessage = (event) => {
                    try {
                        const msg = JSON.parse(event.data);
                        if (msg.id && this.pendingRequests.has(msg.id)) {
                            const pending = this.pendingRequests.get(msg.id);
                            this.pendingRequests.delete(msg.id);
                            clearTimeout(pending.timeout);
                            if (msg.error) {
                                pending.reject(new Error(msg.error.message || 'CDP Error'));
                            } else {
                                pending.resolve(msg.result);
                            }
                        }
                    } catch (e) {}
                };

                ws.onerror = () => {
                    this.cleanupSocket();
                    resolve(false);
                };

                ws.onclose = () => {
                    this.cleanupSocket();
                    if (this.onStatusChange) {
                        this.onStatusChange({ connected: false });
                    }
                };
            } catch (err) {
                this.cleanupSocket();
                resolve(false);
            }
        });
    }

    cleanupSocket() {
        this.isConnected = false;
        if (this.wsClient) {
            try { this.wsClient.close(); } catch (e) {}
            this.wsClient = null;
        }
        for (const [id, req] of this.pendingRequests.entries()) {
            clearTimeout(req.timeout);
            req.reject(new Error('Socket disconnected'));
        }
        this.pendingRequests.clear();
    }

    async inspectState() {
        if (!this.isConnected) return null;

        const inspectionScript = `(() => {
            try {
                const path = window.location.pathname || '';
                const convIdMatch = path.match(/\\/c\\/([a-zA-Z0-9_-]+)/);
                const convId = convIdMatch ? convIdMatch[1] : 'default';

                // Project name discovery
                let projectName = '';
                const workspaceEl = document.querySelector('[data-workspace-name], .workspace-label, .project-name');
                if (workspaceEl && workspaceEl.textContent) {
                    projectName = workspaceEl.textContent.trim();
                }

                // Conversation title discovery
                let convTitle = document.title || '';
                const titleEl = document.querySelector('.active-conversation-title, .chat-title, h1, [data-conversation-title]');
                if (titleEl && titleEl.textContent) {
                    convTitle = titleEl.textContent.trim();
                }

                // Working / generating status discovery
                let isWorking = false;
                const stopBtn = document.querySelector('button[aria-label*="Stop"], button[title*="Stop"], .stop-button, [data-action="stop"]');
                if (stopBtn && stopBtn.offsetParent !== null) {
                    isWorking = true;
                }
                const busyIndicator = document.querySelector('.generating, .thinking, .codicon-loading, .pulse-dot');
                if (busyIndicator && busyIndicator.offsetParent !== null) {
                    isWorking = true;
                }

                // Interactive question discovery (ask_question)
                let pendingQuestion = false;
                const questionContainer = document.querySelector('.interactive-question, .ask-question-card, [data-interactive-question]');
                if (questionContainer && questionContainer.offsetParent !== null) {
                    pendingQuestion = true;
                }

                // Plan approval discovery (Proceed button)
                let pendingPlanProceed = false;
                const proceedBtn = document.querySelector('.btn-proceed-plan, button[data-action="proceed"], [data-plan-proceed]');
                if (proceedBtn && proceedBtn.offsetParent !== null && !proceedBtn.disabled) {
                    pendingPlanProceed = true;
                }

                return {
                    convId,
                    convTitle,
                    projectName,
                    isWorking,
                    pendingQuestion,
                    pendingPlanProceed
                };
            } catch (err) {
                return { error: err.message };
            }
        })()`;

        return await this.evaluateInPage(inspectionScript);
    }

    async pollCycle() {
        if (!this.isRunning) return;

        if (!this.isConnected) {
            const connected = await this.connect();
            if (!connected) {
                // Antigravity not running; schedule next check with idle poll interval
                const idleMs = (this.configManager && this.configManager.getSettings().idlePollIntervalMs) || 4000;
                this.pollTimer = setTimeout(() => this.pollCycle(), idleMs);
                return;
            }
        }

        try {
            const state = await this.inspectState();
            if (state && !state.error && this.service) {
                const convId = state.convId || 'default';
                const convTitle = state.convTitle || '当前任务';
                const projectName = state.projectName || '';

                if (state.isWorking && !this.lastObservedWorking) {
                    this.service.armTaskPendingStart(convId);
                }
                this.lastObservedWorking = Boolean(state.isWorking);

                this.service.evaluateConversationTaskLifecycle({
                    convId,
                    convTitle,
                    projectName,
                    isWorking: state.isWorking,
                    pendingQuestion: state.pendingQuestion,
                    pendingPlanProceed: state.pendingPlanProceed,
                    priorTurns: []
                });
            }
        } catch (e) {
            this.cleanupSocket();
        }

        const activeMs = (this.configManager && this.configManager.getSettings().pollIntervalMs) || 1500;
        this.pollTimer = setTimeout(() => this.pollCycle(), activeMs);
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.pollCycle();
    }

    stop() {
        this.isRunning = false;
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
        this.cleanupSocket();
    }
}

module.exports = {
    AntigravityMonitor
};
