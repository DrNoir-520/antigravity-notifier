// src/monitor.js
// Dual-engine Antigravity observer supporting native storage (SQLite & JSONL) and optional CDP.
// Zero external dependencies.
// English comments only.

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
    fetchActiveConversations,
    getTranscriptTurns,
    inspectTurnStatusFlags
} = require('./transcript');

const FALLBACK_PORTS = [9000, 5743, 9222, 9229, 9333, 9223];

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
        this.isDiskObserved = false;
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
        } catch (_) {}

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
            } catch (_) {}
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
            } catch (_) {}
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
        } catch (_) {
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
                // Using global WebSocket available in modern Node.js
                if (typeof WebSocket === 'undefined') {
                    return resolve(false);
                }
                const ws = new WebSocket(target.webSocketDebuggerUrl);
                this.wsClient = ws;

                ws.onopen = async () => {
                    this.isConnected = true;
                    if (this.onStatusChange) {
                        this.onStatusChange({ connected: true, port, targetUrl: target.url });
                    }
                    try {
                        await this.sendCdpCommand('Runtime.enable');
                    } catch (_) {}
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
                    } catch (_) {}
                };

                ws.onerror = () => {
                    this.cleanupSocket();
                    resolve(false);
                };

                ws.onclose = () => {
                    this.cleanupSocket();
                    if (this.onStatusChange && !this.isDiskObserved) {
                        this.onStatusChange({ connected: false });
                    }
                };
            } catch (_) {
                this.cleanupSocket();
                resolve(false);
            }
        });
    }

    cleanupSocket() {
        this.isConnected = false;
        if (this.wsClient) {
            try { this.wsClient.close(); } catch (_) {}
            this.wsClient = null;
        }
        for (const [, req] of this.pendingRequests.entries()) {
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

                // Cancellation discovery (User cancelled agent execution)
                let isCancelled = false;
                if (!pendingQuestion && !pendingPlanProceed) {
                    const cancelEl = document.querySelector('.cancelled, .cancellation-notice, [data-cancelled], .user-cancelled, .agent-cancelled');
                    if (cancelEl && cancelEl.offsetParent !== null) {
                        isCancelled = true;
                    } else {
                        const view = document.querySelector('[data-testid="conversation-view"]');
                        const activeMsgContainer = view ? (view.querySelector('[data-testid="autoscroll-viewport"] .relative.flex.flex-col.gap-y-3, [data-testid="autoscroll-viewport"] .relative.flex.flex-col, .relative.flex.flex-col.gap-y-3') || view.querySelector('.relative.flex.flex-col')) : null;
                        if (activeMsgContainer && activeMsgContainer.children.length > 0) {
                            const lastRow = activeMsgContainer.children[activeMsgContainer.children.length - 1];
                            if (lastRow) {
                                const walker = document.createTreeWalker(lastRow, NodeFilter.SHOW_TEXT);
                                while (walker.nextNode()) {
                                    const textNode = walker.currentNode;
                                    if (/user cancelled agent execution|cancelled agent execution|agent execution cancelled/i.test(textNode.textContent)) {
                                        const parent = textNode.parentElement;
                                        const isInsideMd = Boolean(parent && parent.closest('[data-testid="planner-response-text"], .cursor-edit, .prose, .markdown-body, code, p, pre'));
                                        if (!isInsideMd) {
                                            isCancelled = true;
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                return {
                    convId,
                    convTitle,
                    projectName,
                    isWorking,
                    isCancelled,
                    pendingQuestion,
                    pendingPlanProceed
                };
            } catch (err) {
                return { error: err.message };
            }
        })()`;

        return await this.evaluateInPage(inspectionScript);
    }

    /**
     * Native storage observer inspecting SQLite conversation database and JSONL transcripts.
     * Operates completely independently from CDP and works with 100% of Antigravity launches.
     * @returns {Promise<boolean>}
     */
    async pollDiskObserver() {
        if (!this.service) return false;
        const convs = fetchActiveConversations(15);
        if (!Array.isArray(convs) || convs.length === 0) {
            return false;
        }

        for (const c of convs) {
            if (!c || !c.convId) continue;
            const taskState = this.service.getConvTaskState(c.convId);
            const isWorking = Boolean(c.isWorking);

            if (isWorking) {
                if (taskState.status !== 'running') {
                    this.service.armTaskPendingStart(c.convId);
                }
            }

            if (isWorking || taskState.status === 'running' || taskState.status === 'settling' || taskState.hasObservedWork) {
                const turns = getTranscriptTurns(c.convId);
                const flags = inspectTurnStatusFlags(c.convId, turns);

                this.service.evaluateConversationTaskLifecycle({
                    convId: c.convId,
                    conv: {
                        id: c.convId,
                        title: c.title,
                        projectName: c.projectName
                    },
                    turns,
                    isWorking,
                    hasPendingProceed: flags.hasPendingProceed,
                    pendingQuestion: flags.pendingQuestion,
                    isCancelled: flags.isCancelled,
                    isCurrentActiveConv: true
                });
            }
        }

        return true;
    }

    async pollCycle() {
        if (!this.isRunning) return;

        let diskActive = false;
        try {
            diskActive = await this.pollDiskObserver();
        } catch (_) {}

        // Attempt CDP connection gently if not yet connected
        if (!this.isConnected) {
            try {
                await this.connect();
            } catch (_) {}
        }

        if (this.isConnected) {
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

                    const turns = getTranscriptTurns(convId);
                    this.service.evaluateConversationTaskLifecycle({
                        convId,
                        conv: {
                            id: convId,
                            title: convTitle,
                            projectName: projectName
                        },
                        turns,
                        isWorking: Boolean(state.isWorking),
                        isCancelled: Boolean(state.isCancelled),
                        pendingQuestion: Boolean(state.pendingQuestion),
                        hasPendingProceed: Boolean(state.pendingPlanProceed),
                        isCurrentActiveConv: true
                    });
                }
            } catch (_) {
                this.cleanupSocket();
            }
        }

        if (diskActive && !this.isDiskObserved) {
            this.isDiskObserved = true;
            if (this.onStatusChange && !this.isConnected) {
                this.onStatusChange({ connected: true, mode: 'disk', message: 'Antigravity storage observer active' });
            }
        } else if (!diskActive && !this.isConnected && this.isDiskObserved) {
            this.isDiskObserved = false;
            if (this.onStatusChange) {
                this.onStatusChange({ connected: false });
            }
        }

        const pollInterval = (diskActive || this.isConnected)
            ? ((this.configManager && this.configManager.getSettings().pollIntervalMs) || 1500)
            : ((this.configManager && this.configManager.getSettings().idlePollIntervalMs) || 4000);

        this.pollTimer = setTimeout(() => this.pollCycle(), pollInterval);
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
