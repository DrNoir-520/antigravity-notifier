// src/notify/notification-service.js
// Centralized service for multi-channel push notifications, Web Push subscriptions,
// and background conversation task execution lifecycle tracking.
// English comments only.

const fs = require('fs');
const path = require('path');
const os = require('os');

const {
    NotificationGateway,
    createNotificationGateway,
    normalizePushUrl,
    getConversationTitle,
    getConversationProjectName,
    deliverPushNotification,
    sendTaskCompletePushNotification: _gatewaySendTaskCompletePushNotification,
    formatCompletionTime,
    formatNotificationTime
} = require('./gateway');

class NotificationService {
    /**
     * @param {Object} [options]
     * @param {Object} [options.config] Runtime server config
     * @param {Function} [options.fetchFn] Custom fetch implementation
     * @param {NotificationGateway} [options.gateway] Pre-configured gateway instance
     * @param {Function} [options.onConfigChange] Callback when settings update
     * @param {Function} [options.getTranscriptTurns] Function to fetch disk transcript turns
     * @param {Function} [options.getCurrentState] Function to get current live state
     * @param {Function} [options.onUnreadStateChange] Callback when background conversation completes
     * @param {Function} [options.onTaskStateChange] Callback for active conversation state sync
     * @param {Function} [options.getAutoApprovalStatus] Function to check auto-approval status
     */
    constructor(options = {}) {
        this.config = options.config || {};
        this.fetchFn = options.fetchFn || global.fetch;
        this.gateway = options.gateway || new NotificationGateway(this.config, { fetchFn: this.fetchFn });
        this.onConfigChange = typeof options.onConfigChange === 'function' ? options.onConfigChange : null;
        this.getTranscriptTurns = typeof options.getTranscriptTurns === 'function' ? options.getTranscriptTurns : (() => []);
        this.getCurrentState = typeof options.getCurrentState === 'function' ? options.getCurrentState : (() => ({}));
        this.onUnreadStateChange = typeof options.onUnreadStateChange === 'function' ? options.onUnreadStateChange : null;
        this.onTaskStateChange = typeof options.onTaskStateChange === 'function' ? options.onTaskStateChange : null;
        this.getAutoApprovalStatus = typeof options.getAutoApprovalStatus === 'function' ? options.getAutoApprovalStatus : null;

        // In-memory registry for browser Web Push subscriptions (endpoint -> SubscriptionRecord)
        this.subscriptions = new Map();

        // Conversation task execution lifecycle state registry
        this.convTaskStates = new Map();
    }

    // -------------------------------------------------------------------------
    // Web Push Subscription Management
    // -------------------------------------------------------------------------

    /**
     * Register a new or existing Web Push subscription.
     * @param {Object} subscription Web Push subscription object (must contain endpoint)
     * @param {Object} [metadata] Optional metadata (e.g. userAgent)
     * @returns {{ ok: boolean, subscription?: Object, error?: string }}
     */
    addSubscription(subscription, metadata = {}) {
        if (!subscription || typeof subscription !== 'object' || !subscription.endpoint || typeof subscription.endpoint !== 'string') {
            return { ok: false, error: 'Subscription endpoint is required' };
        }
        const endpoint = subscription.endpoint.trim();
        if (!endpoint) {
            return { ok: false, error: 'Subscription endpoint cannot be empty' };
        }

        const existing = this.subscriptions.get(endpoint);
        const record = {
            endpoint,
            keys: subscription.keys || (existing && existing.keys) || {},
            expirationTime: subscription.expirationTime || null,
            userAgent: metadata.userAgent || (existing && existing.userAgent) || '',
            createdAt: existing ? existing.createdAt : Date.now(),
            lastUsedAt: Date.now()
        };

        this.subscriptions.set(endpoint, record);
        return { ok: true, subscription: record };
    }

    /**
     * Remove a Web Push subscription by its endpoint.
     * @param {string} endpoint
     * @returns {{ ok: boolean, removed: boolean }}
     */
    removeSubscription(endpoint) {
        if (!endpoint || typeof endpoint !== 'string') {
            return { ok: false, removed: false, error: 'Endpoint string is required' };
        }
        const removed = this.subscriptions.delete(endpoint.trim());
        return { ok: true, removed };
    }

    /**
     * Get all active Web Push subscriptions.
     * @returns {Array<Object>}
     */
    getSubscriptions() {
        return Array.from(this.subscriptions.values());
    }

    /**
     * Check if a subscription endpoint exists.
     * @param {string} endpoint
     * @returns {boolean}
     */
    hasSubscription(endpoint) {
        if (!endpoint || typeof endpoint !== 'string') return false;
        return this.subscriptions.has(endpoint.trim());
    }

    /**
     * Clear all stored subscriptions.
     */
    clearSubscriptions() {
        this.subscriptions.clear();
    }

    /**
     * Dispatch notification payload to all registered Web Push subscribers.
     * Automatically prunes expired endpoints returning 404 or 410.
     * @param {Object} payload
     * @returns {Promise<{ total: number, successful: number, failed: number }>}
     */
    async notifyWebPushSubscribers(payload) {
        const subscribers = this.getSubscriptions();
        if (subscribers.length === 0) {
            return { total: 0, successful: 0, failed: 0 };
        }

        let successful = 0;
        let failed = 0;

        await Promise.allSettled(subscribers.map(async (sub) => {
            try {
                const res = await this.fetchFn(sub.endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    signal: AbortSignal.timeout(8000)
                });

                if (res.status === 404 || res.status === 410) {
                    // Subscription expired or uninstalled; prune
                    this.subscriptions.delete(sub.endpoint);
                    failed++;
                } else if (res.ok) {
                    sub.lastUsedAt = Date.now();
                    successful++;
                } else {
                    failed++;
                }
            } catch (err) {
                failed++;
            }
        }));

        return { total: subscribers.length, successful, failed };
    }

    // -------------------------------------------------------------------------
    // Push Notification Settings & Gateway Delegation
    // -------------------------------------------------------------------------

    /**
     * Check if auto-approval for plans is currently enabled.
     * Evaluates explicit configuration, callback function, or global Antigravity settings.
     * @returns {boolean}
     */
    isAutoApprovalEnabled() {
        if (typeof this.config.autoApprovePlan === 'boolean') {
            return this.config.autoApprovePlan;
        }
        if (typeof this.config.autoProceed === 'boolean') {
            return this.config.autoProceed;
        }
        if (typeof this.config.autoApproval === 'boolean') {
            return this.config.autoApproval;
        }
        if (typeof this.getAutoApprovalStatus === 'function') {
            try {
                const status = this.getAutoApprovalStatus();
                if (typeof status === 'boolean') return status;
            } catch (_) {}
        }
        return NotificationService.detectGeminiAutoApproval();
    }

    /**
     * Check Antigravity / Gemini global config for Turbo/Always Proceed plan review mode.
     * @returns {boolean}
     */
    static detectGeminiAutoApproval() {
        try {
            const homeDir = os.homedir();
            const geminiConfigPath = path.join(homeDir, '.gemini', 'config', 'config.json');
            if (fs.existsSync(geminiConfigPath)) {
                const raw = fs.readFileSync(geminiConfigPath, 'utf8');
                const data = JSON.parse(raw);
                const userSettings = data && data.userSettings;
                if (userSettings) {
                    if (userSettings.artifactReviewMode === 'ARTIFACT_REVIEW_MODE_TURBO') {
                        return true;
                    }
                    if (userSettings.planReviewPolicy === 'Always Proceed') {
                        return true;
                    }
                }
            }
        } catch (_) {}
        return false;
    }

    /**
     * Get configured delay in seconds before sending push notification for a pending question.
     * Defaults to 4 seconds, or reads from config/environment variable QUESTION_NOTIFICATION_DELAY_SECONDS.
     * @returns {number}
     */
    getQuestionNotificationDelaySeconds() {
        if (typeof this.config.questionNotificationDelaySeconds === 'number' && this.config.questionNotificationDelaySeconds >= 0) {
            return this.config.questionNotificationDelaySeconds;
        }
        if (typeof this.config.questionNotificationDelayMs === 'number' && this.config.questionNotificationDelayMs >= 0) {
            return Math.floor(this.config.questionNotificationDelayMs / 1000);
        }
        if (process.env.QUESTION_NOTIFICATION_DELAY_SECONDS !== undefined && !isNaN(Number(process.env.QUESTION_NOTIFICATION_DELAY_SECONDS))) {
            return Math.max(0, Number(process.env.QUESTION_NOTIFICATION_DELAY_SECONDS));
        }
        return 4;
    }

    /**
     * Get configured delay in milliseconds before sending push notification for a pending question.
     * @param {number} [defaultFallbackMs=4000]
     * @returns {number}
     */
    getQuestionNotificationDelayMs(defaultFallbackMs = 4000) {
        if (typeof this.config.questionNotificationDelaySeconds === 'number' && this.config.questionNotificationDelaySeconds >= 0) {
            return this.config.questionNotificationDelaySeconds * 1000;
        }
        if (typeof this.config.questionNotificationDelayMs === 'number' && this.config.questionNotificationDelayMs >= 0) {
            return this.config.questionNotificationDelayMs;
        }
        if (process.env.QUESTION_NOTIFICATION_DELAY_SECONDS !== undefined && !isNaN(Number(process.env.QUESTION_NOTIFICATION_DELAY_SECONDS))) {
            return Math.max(0, Number(process.env.QUESTION_NOTIFICATION_DELAY_SECONDS) * 1000);
        }
        return defaultFallbackMs;
    }

    /**
     * Programmatically update the question notification delay in seconds.
     * @param {number} seconds
     * @returns {number}
     */
    setQuestionNotificationDelaySeconds(seconds) {
        const val = Math.max(0, Number(seconds) || 0);
        this.config.questionNotificationDelaySeconds = val;
        if (this.onConfigChange) {
            try { this.onConfigChange(this.config); } catch (e) {}
        }
        return val;
    }

    /**
     * Get current push notification settings.
     * @returns {{ ok: boolean, enabled: boolean, pushUrl: string, autoApprovePlan: boolean, questionNotificationDelaySeconds: number, subscriptionsCount: number }}
     */
    getSettings() {
        return {
            ok: true,
            enabled: Boolean(this.config.pushNotificationEnabled),
            pushUrl: this.config.pushNotificationUrl || '',
            autoApprovePlan: this.isAutoApprovalEnabled(),
            questionNotificationDelaySeconds: this.getQuestionNotificationDelaySeconds(),
            subscriptionsCount: this.subscriptions.size
        };
    }

    /**
     * Update push notification settings.
     * @param {Object} [payload]
     * @param {boolean} [payload.enabled]
     * @param {string} [payload.pushUrl]
     * @param {boolean} [payload.autoApprovePlan]
     * @param {number} [payload.questionNotificationDelaySeconds]
     * @returns {{ ok: boolean, enabled: boolean, pushUrl: string, autoApprovePlan: boolean, questionNotificationDelaySeconds: number }}
     */
    updateSettings(payload = {}) {
        const { enabled, pushUrl, autoApprovePlan, questionNotificationDelaySeconds } = payload;
        if (typeof enabled === 'boolean') {
            this.config.pushNotificationEnabled = enabled;
        }
        if (typeof pushUrl === 'string') {
            this.config.pushNotificationUrl = pushUrl.trim();
        }
        if (typeof autoApprovePlan === 'boolean') {
            this.config.autoApprovePlan = autoApprovePlan;
        }
        if (questionNotificationDelaySeconds !== undefined) {
            const sec = Number(questionNotificationDelaySeconds);
            if (!isNaN(sec) && sec >= 0) {
                this.config.questionNotificationDelaySeconds = sec;
            }
        }
        this.gateway.setConfig(this.config);

        if (this.onConfigChange) {
            try {
                this.onConfigChange(this.config);
            } catch (e) {}
        }

        return {
            ok: true,
            enabled: this.config.pushNotificationEnabled,
            pushUrl: this.config.pushNotificationUrl || '',
            autoApprovePlan: this.isAutoApprovalEnabled(),
            questionNotificationDelaySeconds: this.getQuestionNotificationDelaySeconds()
        };
    }

    /**
     * Test notification delivery to a target URL or current configured URL.
     * @param {Object} options
     * @returns {Promise<Object>}
     */
    async testNotification(options = {}) {
        const { pushUrl, convTitle, projectName, convId, currentConv, currentTree, currentTurns } = options;
        const targetUrl = String(pushUrl || this.config.pushNotificationUrl || '').trim();
        if (!targetUrl) {
            return { ok: false, error: 'Push URL or key is required' };
        }

        const resolvedTitle = (convTitle && typeof convTitle === 'string' && convTitle.trim())
            ? convTitle.trim()
            : getConversationTitle(currentConv, currentTree, currentTurns);

        const resolvedProject = (projectName && typeof projectName === 'string' && projectName.trim())
            ? projectName.trim()
            : (getConversationProjectName(currentConv, currentTree) || '独立对话');

        const result = await this.gateway.testChannel(targetUrl, {
            convTitle: resolvedTitle,
            projectName: resolvedProject,
            convId: convId || (currentConv ? currentConv.id : null)
        });

        if (result.ok) {
            return {
                ok: true,
                message: 'Test notification sent successfully',
                normalizedUrl: result.normalizedUrl
            };
        }

        return {
            ok: false,
            error: result.error || 'Failed to deliver notification to target URL. Please check the URL and network.',
            normalizedUrl: result.normalizedUrl
        };
    }

    /**
     * Send task complete push notification.
     * @param {Object|string} titleOrOptions
     * @param {string} [maybeMessage]
     * @param {string} [maybeConvId]
     * @param {Object} [customConfig]
     * @returns {Promise<boolean>}
     */
    async sendTaskCompletePushNotification(titleOrOptions, maybeMessage, maybeConvId, customConfig = null) {
        if (customConfig && customConfig !== this.config) {
            return _gatewaySendTaskCompletePushNotification(titleOrOptions, maybeMessage, maybeConvId, customConfig, this.fetchFn);
        }

        if (typeof titleOrOptions === 'object' && titleOrOptions !== null) {
            const state = this.getCurrentState();
            return this.gateway.notifyTaskEvent({
                conv: state.currentConv,
                tree: state.currentTree,
                turns: state.currentTurns,
                ...titleOrOptions
            });
        }

        return _gatewaySendTaskCompletePushNotification(titleOrOptions, maybeMessage, maybeConvId, this.config, this.fetchFn);
    }

    // -------------------------------------------------------------------------
    // Task Lifecycle State Machine & Sidebar Inspection
    // -------------------------------------------------------------------------

    /**
     * Check if a conversation is actively marked as running in sidebar.
     * @param {Object} tree
     * @param {string} [convId]
     * @returns {boolean}
     */
    isConversationRunningInSidebar(tree, convId) {
        if (!tree) return false;
        const targetId = convId || tree.activeConvId;
        if (!targetId) return false;
        if (Array.isArray(tree.pinned)) {
            const found = tree.pinned.find(c => c.id === targetId);
            if (found && found.isRunning) return true;
        }
        if (Array.isArray(tree.standalone)) {
            const found = tree.standalone.find(c => c.id === targetId);
            if (found && found.isRunning) return true;
        }
        if (Array.isArray(tree.projects)) {
            for (const p of tree.projects) {
                if (Array.isArray(p.conversations)) {
                    const found = p.conversations.find(c => c.id === targetId);
                    if (found && found.isRunning) return true;
                }
            }
        }
        return false;
    }

    /**
     * Extract all conversations across pinned, standalone, and project groups from tree.
     * @param {Object} tree
     * @returns {Array<Object>}
     */
    getAllTreeConversations(tree) {
        if (!tree) return [];
        const list = [];
        const seen = new Set();
        const add = (c, defaultProjectName, defaultProjectId) => {
            if (c && c.id && !seen.has(c.id)) {
                seen.add(c.id);
                list.push({
                    ...c,
                    projectId: c.projectId || defaultProjectId || undefined,
                    projectName: c.projectName || defaultProjectName || undefined
                });
            }
        };
        if (Array.isArray(tree.pinned)) {
            tree.pinned.forEach(c => add(c, c.subtext, undefined));
        }
        if (Array.isArray(tree.standalone)) {
            tree.standalone.forEach(c => add(c, undefined, 'outside-of-project'));
        }
        if (Array.isArray(tree.projects)) {
            for (const p of tree.projects) {
                if (Array.isArray(p.conversations)) {
                    p.conversations.forEach(c => add(c, p.name, p.id));
                }
            }
        }
        return list;
    }

    /**
     * Check if any conversation in sidebar is currently running.
     * @param {Object} tree
     * @returns {boolean}
     */
    isAnyConversationRunningInSidebar(tree) {
        if (!tree) return false;
        if (Array.isArray(tree.pinned) && tree.pinned.some(c => c && c.isRunning)) return true;
        if (Array.isArray(tree.standalone) && tree.standalone.some(c => c && c.isRunning)) return true;
        if (Array.isArray(tree.projects)) {
            for (const p of tree.projects) {
                if (Array.isArray(p.conversations) && p.conversations.some(c => c && c.isRunning)) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Get or initialize per-conversation task lifecycle state tracker.
     * Prunes old idle states when map size exceeds 120.
     * @param {string} [convId]
     * @returns {Object}
     */
    getConvTaskState(convId) {
        const key = convId || 'default';
        let state = this.convTaskStates.get(key);
        if (!state) {
            if (this.convTaskStates.size > 120) {
                for (const [k, s] of this.convTaskStates.entries()) {
                    if (s.status === 'idle' && !s.settlingTimer && k !== key) {
                        this.convTaskStates.delete(k);
                        if (this.convTaskStates.size <= 80) break;
                    }
                }
            }
            state = {
                status: 'idle', // 'idle' | 'pending_start' | 'running' | 'settling'
                hasObservedWork: false,
                settlingTimer: null,
                lastNotifiedUserTurnId: '',
                lastNotifiedModelTurnId: '',
                lastNotifiedTurnSignature: '',
                priorUserTurnId: '',
                priorModelTurnId: '',
                submittedAt: 0
            };
            this.convTaskStates.set(key, state);
        }
        return state;
    }

    /**
     * Check if any conversation has an active task in flight.
     * @returns {boolean}
     */
    hasAnyActiveTask() {
        for (const state of this.convTaskStates.values()) {
            if (state.status === 'pending_start' || state.status === 'running' || state.status === 'settling' || state.settlingTimer !== null) {
                return true;
            }
        }
        return false;
    }

    /**
     * Arm task execution state tracker when user submits a new prompt.
     * @param {string} [convId]
     * @param {string} [priorUserTurnId='']
     * @returns {Object}
     */
    armTaskPendingStart(convId, priorUserTurnId = '') {
        const key = convId || 'default';
        const convState = this.getConvTaskState(key);
        convState.status = 'pending_start';
        convState.hasObservedWork = false;
        convState.submittedAt = Date.now();
        if (convState.settlingTimer) {
            clearTimeout(convState.settlingTimer);
            convState.settlingTimer = null;
        }
        convState.priorUserTurnId = priorUserTurnId;
        convState.lastNotifiedUserTurnId = priorUserTurnId;
        convState.lastNotifiedTurnSignature = '';
        if (this.onTaskStateChange) {
            this.onTaskStateChange(convState);
        }
        return convState;
    }

    /**
     * Mark a conversation as manually cancelled/interrupted.
     * @param {string} convId
     */
    markConversationCancelled(convId) {
        if (!convId || convId === 'default') return;
        const taskState = this.getConvTaskState(convId);
        taskState.isCancelled = true;
    }

    /**
     * Evaluate task execution lifecycle for a specific conversation.
     * Implements strict deduplication, settling guards, and multi-channel delivery.
     * @param {Object} options
     * @returns {Object|null}
     */
    evaluateConversationTaskLifecycle({
        convId,
        conv,
        turns,
        isWorking,
        hasPendingProceed,
        pendingQuestion,
        isCancelled,
        isCurrentActiveConv,
        sendNotificationFn,
        settlingDelayMs,
        context = null
    }) {
        if (!convId || convId === 'default') return null;

        const liveContext = context || this.getCurrentState();
        const taskState = this.getConvTaskState(convId);
        if (isCancelled) {
            taskState.isCancelled = true;
        }
        const effTurns = turns || [];
        let lastUserTurn = null;
        let lastModelTurn = null;
        let lastUserIdx = -1;
        let lastModelIdx = -1;

        for (let i = effTurns.length - 1; i >= 0; i--) {
            if (!lastModelTurn && effTurns[i].role === 'assistant') {
                lastModelTurn = effTurns[i];
                lastModelIdx = i;
            }
            if (!lastUserTurn && effTurns[i].role === 'user') {
                lastUserTurn = effTurns[i];
                lastUserIdx = i;
            }
            if (lastModelTurn && lastUserTurn) break;
        }

        const hasPendingQuestion = Boolean(
            pendingQuestion ||
            (lastModelTurn && Array.isArray(lastModelTurn.tools) && lastModelTurn.tools.some(t => t.name === 'ask_question'))
        );
        const isSuspendedForUser = Boolean(hasPendingQuestion || hasPendingProceed);
        const effIsWorking = isSuspendedForUser ? false : isWorking;

        if (taskState.status === 'pending_start') {
            if (isSuspendedForUser) {
                taskState.hasObservedWork = true;
                taskState.status = 'running';
                console.log(`⚡ [Push-Debug] User action suspended (question/proceed) detected for conv "${convId}" during pending_start.`);
            } else if (Date.now() - (taskState.submittedAt || 0) > 90000) {
                taskState.status = 'idle';
            }
        }

        if (effIsWorking) {
            if (taskState.status !== 'running') {
                console.log(`⚡ [Push-Debug] Work detected for conv "${convId}". Status transitioning to running.`);
            }
            taskState.status = 'running';
            taskState.hasObservedWork = true;
            taskState.isCancelled = false;
            if (taskState.settlingTimer) {
                console.log(`⚡ [Push-Debug] Resetting settling timer for "${convId}" as work has resumed.`);
                clearTimeout(taskState.settlingTimer);
                taskState.settlingTimer = null;
            }
        } else if (taskState.status === 'running' || (taskState.hasObservedWork && taskState.status !== 'settling')) {
            const hasPendingQuestion = Boolean(
                pendingQuestion ||
                (lastModelTurn && Array.isArray(lastModelTurn.tools) && lastModelTurn.tools.some(t => t.name === 'ask_question'))
            );
            const isTaskCancelled = Boolean(taskState.isCancelled) && !hasPendingQuestion && !hasPendingProceed;
            const modelHasOutput = Boolean(
                isTaskCancelled ||
                lastModelTurn && (
                    (typeof lastModelTurn.text === 'string' && lastModelTurn.text.trim().length > 0) ||
                    (Array.isArray(lastModelTurn.tools) && lastModelTurn.tools.length > 0) ||
                    (Array.isArray(lastModelTurn.artifacts) && lastModelTurn.artifacts.length > 0) ||
                    hasPendingProceed ||
                    hasPendingQuestion
                )
            );

            const isNewUserTurn = !taskState.priorUserTurnId || (lastUserTurn && lastUserTurn.id !== taskState.priorUserTurnId);
            const isExecutionPhase = Boolean(
                !hasPendingProceed &&
                !hasPendingQuestion &&
                taskState.priorModelTurnId &&
                lastModelTurn &&
                lastModelTurn.id !== taskState.priorModelTurnId
            );
            const isNewRound = isNewUserTurn || isExecutionPhase;

            const hasValidRound = isTaskCancelled
                ? Boolean(lastUserTurn)
                : Boolean(
                    lastUserTurn &&
                    lastModelTurn &&
                    lastModelIdx > lastUserIdx &&
                    !lastModelTurn.isThinking &&
                    modelHasOutput &&
                    isNewRound &&
                    (!Array.isArray(lastModelTurn.tools) || !lastModelTurn.tools.some(t => t.status === 'running' && t.name !== 'ask_question'))
                );

            if (!hasValidRound) {
                // Keep waiting until assistant completes turn or valid round exists
                if (isCurrentActiveConv && this.onTaskStateChange) {
                    this.onTaskStateChange(taskState);
                }
                return taskState;
            }

            const uId = (lastUserTurn && lastUserTurn.id) ? lastUserTurn.id : ('u_' + lastUserIdx);
            const mId = (lastModelTurn && lastModelTurn.id) ? lastModelTurn.id : ('m_' + lastModelIdx);

            const targetSignature = hasPendingQuestion
                ? (uId + '::' + mId + '::question_pending')
                : (hasPendingProceed
                    ? (uId + '::' + mId + '::proceed_pending')
                    : (isTaskCancelled
                        ? (uId + '::' + mId + '::cancelled')
                        : (uId + '::' + mId)));

            let isAlreadyNotified = false;
            if (taskState.lastNotifiedTurnSignature && taskState.lastNotifiedTurnSignature === targetSignature) {
                isAlreadyNotified = true;
            } else if (!isTaskCancelled && !hasPendingProceed && !hasPendingQuestion && !isExecutionPhase) {
                if (taskState.lastNotifiedUserTurnId && taskState.lastNotifiedUserTurnId === uId) {
                    isAlreadyNotified = true;
                }
            }

            if (isAlreadyNotified) {
                taskState.status = 'idle';
                taskState.hasObservedWork = false;
            } else if (!taskState.settlingTimer) {
                taskState.status = 'settling';
                const targetConvId = convId;
                const defaultSettlingDelay = typeof settlingDelayMs === 'number' ? settlingDelayMs : 4000;
                const delay = hasPendingQuestion
                    ? (typeof settlingDelayMs === 'number' ? settlingDelayMs : this.getQuestionNotificationDelayMs(defaultSettlingDelay))
                    : defaultSettlingDelay;
                console.log(`⏳ [Push-Debug] Task settling timer scheduled (${delay}ms) for "${targetConvId}". Signature: ${targetSignature}`);

                taskState.settlingTimer = setTimeout(async () => {
                    taskState.settlingTimer = null;

                    const curState = this.getCurrentState();
                    const currentConv = curState.currentConv;
                    const currentTree = curState.currentTree;
                    const currentTurns = curState.currentTurns;
                    const currentIsGenerating = curState.currentIsGenerating;
                    const currentIsThinking = curState.currentIsThinking;
                    const currentRunningTasks = curState.currentRunningTasks;
                    const currentPendingQuestion = curState.currentPendingQuestion;
                    const currentHasPendingProceed = curState.currentHasPendingProceed;

                    const isStillActiveInDom = (((currentConv && currentConv.id) || (currentTree && currentTree.activeConvId)) === targetConvId);
                    const isStillRunningInSidebar = this.isConversationRunningInSidebar(currentTree, targetConvId);

                    // Fetch fresh turns to inspect current state
                    let freshTurns = isStillActiveInDom ? (currentTurns || []) : this.getTranscriptTurns(targetConvId);
                    if (!freshTurns || freshTurns.length === 0) {
                        freshTurns = (effTurns && effTurns.length > 0) ? effTurns : this.getTranscriptTurns(targetConvId);
                    }

                    let freshUser = null;
                    let freshModel = null;
                    let freshUIdx = -1;
                    let freshMIdx = -1;
                    for (let j = freshTurns.length - 1; j >= 0; j--) {
                        if (!freshModel && freshTurns[j].role === 'assistant') {
                            freshModel = freshTurns[j];
                            freshMIdx = j;
                        }
                        if (!freshUser && freshTurns[j].role === 'user') {
                            freshUser = freshTurns[j];
                            freshUIdx = j;
                        }
                        if (freshModel && freshUser) break;
                    }

                    // Check if interactive question modal or plan approval is active
                    const isQuestionPending = isStillActiveInDom
                        ? (Boolean(currentPendingQuestion) || (freshModel && Array.isArray(freshModel.tools) && freshModel.tools.some(t => t.name === 'ask_question')))
                        : freshTurns.some(t =>
                            t.role === 'assistant' &&
                            Array.isArray(t.tools) &&
                            t.tools.some(tool => tool.name === 'ask_question') &&
                            t === freshTurns[freshTurns.length - 1]
                        );

                    const isPlanApprovalPending = isStillActiveInDom
                        ? Boolean(currentHasPendingProceed)
                        : freshTurns.some(t => t.role === 'assistant' && Array.isArray(t.artifacts) && t.artifacts.some(a => a.canProceed && !a.proceeded));

                    const isSuspendedForUserAction = Boolean(isQuestionPending || isPlanApprovalPending);

                    // Guard 1: Verify this specific conversation has not resumed work
                    // Note: When waiting for user action (pending question or plan approval), Antigravity sidebar
                    // may still mark the conversation as running, but execution is paused. We must not treat that as resumed work.
                    let isStillWorking = false;
                    if (isStillActiveInDom) {
                        isStillWorking = Boolean(
                            (!isSuspendedForUserAction && currentIsGenerating) ||
                            (!isSuspendedForUserAction && currentIsThinking) ||
                            (Array.isArray(currentRunningTasks) && currentRunningTasks.length > 0) ||
                            (!isSuspendedForUserAction && isStillRunningInSidebar) ||
                            (!isSuspendedForUserAction && (currentTurns || []).some(t =>
                                t.role === 'assistant' &&
                                Array.isArray(t.tools) &&
                                t.tools.some(tool => tool.status === 'running' && tool.name !== 'ask_question')
                            ))
                        );
                    } else {
                        isStillWorking = !isSuspendedForUserAction && isStillRunningInSidebar;
                    }

                    if (isStillWorking) {
                        console.log(`⚠️ [Push-Debug] Guard 1: conversation "${targetConvId}" resumed work, returning to running.`);
                        taskState.status = 'running';
                        if (isStillActiveInDom && this.onTaskStateChange) this.onTaskStateChange(taskState);
                        return;
                    }

                    // Guard 2: Fresh turns validation
                    const isTaskCancelled = Boolean(taskState.isCancelled) && !isQuestionPending && !isPlanApprovalPending;
                    const freshModelHasOutput = Boolean(
                        isTaskCancelled ||
                        freshModel && (
                            (typeof freshModel.text === 'string' && freshModel.text.trim().length > 0) ||
                            (Array.isArray(freshModel.tools) && freshModel.tools.length > 0) ||
                            (Array.isArray(freshModel.artifacts) && freshModel.artifacts.length > 0) ||
                            isPlanApprovalPending ||
                            isQuestionPending
                        )
                    );

                    if (!isTaskCancelled) {
                        if (!freshUser || !freshModel || freshMIdx <= freshUIdx || freshModel.isThinking || !freshModelHasOutput) {
                            console.log(`⚠️ [Push-Debug] Guard 3: fresh turns validation failed for "${targetConvId}".`);
                            taskState.status = 'idle';
                            if (isStillActiveInDom && this.onTaskStateChange) this.onTaskStateChange(taskState);
                            return;
                        }
                    } else {
                        if (!freshUser) {
                            console.log(`⚠️ [Push-Debug] Guard 3: fresh user turn missing for cancelled "${targetConvId}".`);
                            taskState.status = 'idle';
                            if (isStillActiveInDom && this.onTaskStateChange) this.onTaskStateChange(taskState);
                            return;
                        }
                    }

                    if (!isTaskCancelled && Array.isArray(freshModel.tools) && freshModel.tools.some(t => t.status === 'running' && t.name !== 'ask_question')) {
                        console.log(`⚠️ [Push-Debug] Guard 3b: assistant tool still running for "${targetConvId}".`);
                        taskState.status = 'running';
                        if (isStillActiveInDom && this.onTaskStateChange) this.onTaskStateChange(taskState);
                        return;
                    }

                    const freshUId = (freshUser && freshUser.id) ? freshUser.id : ('u_' + freshUIdx);
                    const freshMId = (freshModel && freshModel.id) ? freshModel.id : (freshMIdx >= 0 ? ('m_' + freshMIdx) : 'm_cancelled');

                    const freshSignature = isQuestionPending
                        ? (freshUId + '::' + freshMId + '::question_pending')
                        : (isPlanApprovalPending
                            ? (freshUId + '::' + freshMId + '::proceed_pending')
                            : (isTaskCancelled
                                ? (freshUId + '::' + freshMId + '::cancelled')
                                : (freshUId + '::' + freshMId)));

                    // Guard 4: Deduplication check
                    if (taskState.lastNotifiedTurnSignature && taskState.lastNotifiedTurnSignature === freshSignature) {
                        console.log(`⚠️ [Push-Debug] Guard 4: turn signature already notified for "${targetConvId}":`, freshSignature);
                        taskState.status = 'idle';
                        if (isStillActiveInDom && this.onTaskStateChange) this.onTaskStateChange(taskState);
                        return;
                    }

                    const freshIsExecutionPhase = Boolean(
                        !isPlanApprovalPending &&
                        !isQuestionPending &&
                        taskState.priorModelTurnId &&
                        freshMId !== taskState.priorModelTurnId
                    );

                    if (!isTaskCancelled && !isPlanApprovalPending && !isQuestionPending && !freshIsExecutionPhase) {
                        if (taskState.lastNotifiedUserTurnId && taskState.lastNotifiedUserTurnId === freshUId) {
                            console.log(`⚠️ [Push-Debug] Guard 4b: user turn already notified for "${targetConvId}":`, freshUId);
                            taskState.status = 'idle';
                            if (isStillActiveInDom && this.onTaskStateChange) this.onTaskStateChange(taskState);
                            return;
                        }
                    }

                    const targetConvObj = conv || { id: targetConvId };
                    const convTitle = getConversationTitle(targetConvObj, currentTree, freshTurns);
                    const rawProjectName = getConversationProjectName(targetConvObj, currentTree);
                    const projectName = rawProjectName || '独立对话';

                    // Auto-approval suppression for Implementation Plan:
                    // If user has auto-approval enabled, suppress pending approval notification because the plan executes automatically.
                    if (isPlanApprovalPending && this.isAutoApprovalEnabled()) {
                        console.log(`ℹ️ [Push] Auto-approval is enabled. Suppressing "待确认" notification for "${convTitle}" [convId: ${targetConvId}].`);
                        taskState.lastNotifiedTurnSignature = freshSignature;
                        taskState.lastNotifiedModelTurnId = freshMId;
                        taskState.priorModelTurnId = freshMId;
                        taskState.status = 'idle';
                        taskState.hasObservedWork = false;
                        if (isStillActiveInDom && this.onTaskStateChange) this.onTaskStateChange(taskState);
                        return;
                    }

                    // Synchronously latch deduplication flags before async dispatch
                    if (isQuestionPending || isPlanApprovalPending) {
                        taskState.lastNotifiedTurnSignature = freshSignature;
                        taskState.lastNotifiedModelTurnId = freshMId;
                        taskState.priorModelTurnId = freshMId;
                    } else {
                        taskState.lastNotifiedUserTurnId = freshUId;
                        taskState.lastNotifiedModelTurnId = freshMId;
                        taskState.lastNotifiedTurnSignature = freshSignature;
                        taskState.priorUserTurnId = freshUId;
                        taskState.priorModelTurnId = freshMId;
                    }
                    taskState.status = 'idle';
                    taskState.hasObservedWork = false;
                    if (isStillActiveInDom && this.onTaskStateChange) this.onTaskStateChange(taskState);

                    // Synchronize unread state for completed background conversation
                    if (!isCurrentActiveConv && targetConvId && this.onUnreadStateChange) {
                        try {
                            this.onUnreadStateChange(targetConvId);
                        } catch (e) {}
                    }

                    const completedTime = new Date();
                    const timeHm = formatNotificationTime(completedTime);

                    const status = isQuestionPending ? '待输入' : (isPlanApprovalPending ? '待确认' : (isTaskCancelled ? '已中断' : '已完成'));
                    const pushTitle = `${convTitle}（${projectName}）${status} ${timeHm}`;

                    console.log(`🔔 [Push] Task event genuinely settled for "${convTitle}" [Project: ${projectName}, Status: ${status}] (convId: ${targetConvId}). Sending notification.`);

                    const notificationPayload = {
                        title: pushTitle,
                        convTitle,
                        projectName,
                        completedAt: completedTime,
                        convId: targetConvId,
                        isCancelled: isTaskCancelled,
                        isPlanApprovalPending,
                        isQuestionPending,
                        statusText: status
                    };
                    taskState.isCancelled = false;

                    const dispatchFn = typeof sendNotificationFn === 'function'
                        ? sendNotificationFn
                        : ((payload) => this.sendTaskCompletePushNotification(payload));

                    await dispatchFn(notificationPayload);

                    // Also dispatch to registered Web Push browser subscribers
                    if (this.subscriptions.size > 0) {
                        this.notifyWebPushSubscribers(notificationPayload).catch(() => {});
                    }
                }, delay);
            }
        } else if (taskState.status === 'idle' && !taskState.hasObservedWork) {
            const hasPendingQuestion = Boolean(pendingQuestion);
            const modelHasOutput = Boolean(
                lastModelTurn && (
                    (typeof lastModelTurn.text === 'string' && lastModelTurn.text.trim().length > 0) ||
                    (Array.isArray(lastModelTurn.tools) && lastModelTurn.tools.length > 0) ||
                    (Array.isArray(lastModelTurn.artifacts) && lastModelTurn.artifacts.length > 0) ||
                    hasPendingProceed ||
                    hasPendingQuestion
                )
            );
            if (lastUserTurn && lastModelTurn && lastModelIdx > lastUserIdx && !lastModelTurn.isThinking && modelHasOutput) {
                if (!taskState.lastNotifiedTurnSignature) {
                    taskState.lastNotifiedTurnSignature = hasPendingQuestion
                        ? (lastUserTurn.id + '::' + lastModelTurn.id + '::question_pending')
                        : (hasPendingProceed
                            ? (lastUserTurn.id + '::' + lastModelTurn.id + '::proceed_pending')
                            : (lastUserTurn.id + '::' + lastModelTurn.id));
                    taskState.lastNotifiedUserTurnId = (hasPendingProceed || hasPendingQuestion) ? '' : lastUserTurn.id;
                    taskState.lastNotifiedModelTurnId = lastModelTurn.id;
                    taskState.priorUserTurnId = lastUserTurn.id;
                    taskState.priorModelTurnId = lastModelTurn.id;
                }
            }
        }

        if (isCurrentActiveConv && this.onTaskStateChange) {
            this.onTaskStateChange(taskState);
        }
        return taskState;
    }
}

module.exports = {
    NotificationService,
    NotificationGateway,
    createNotificationGateway,
    normalizePushUrl,
    getConversationTitle,
    getConversationProjectName,
    deliverPushNotification,
    formatCompletionTime
};
