// src/transcript.js
// Native Antigravity SQLite database and JSONL transcript reader.
// Zero external dependencies.
// English comments only.

const fs = require('fs');
const path = require('path');
const os = require('os');

let DatabaseSync = null;
try {
    const sqlite = require('node:sqlite');
    DatabaseSync = sqlite.DatabaseSync;
} catch (_) {}

/**
 * Resolve path to Antigravity SQLite conversation database.
 * @returns {string|null}
 */
function resolveDatabasePath() {
    const candidates = [
        path.join(os.homedir(), '.gemini', 'antigravity', 'conversation_summaries.db'),
        path.join('C:\\Users\\Administrator', '.gemini', 'antigravity', 'conversation_summaries.db')
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

/**
 * Resolve path to JSONL transcript file for a given conversation.
 * Prefers transcript_full.jsonl if available to avoid truncated fields.
 * @param {string} convId
 * @returns {string|null}
 */
function resolveTranscriptPath(convId) {
    if (!convId || typeof convId !== 'string') return null;
    const cleanId = convId.trim();
    const candidates = [
        path.join(os.homedir(), '.gemini', 'antigravity', 'brain', cleanId, '.system_generated', 'logs', 'transcript_full.jsonl'),
        path.join(os.homedir(), '.gemini', 'antigravity', 'brain', cleanId, '.system_generated', 'logs', 'transcript.jsonl'),
        path.join('C:\\Users\\Administrator', '.gemini', 'antigravity', 'brain', cleanId, '.system_generated', 'logs', 'transcript_full.jsonl'),
        path.join('C:\\Users\\Administrator', '.gemini', 'antigravity', 'brain', cleanId, '.system_generated', 'logs', 'transcript.jsonl')
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

/**
 * Extract clean project name from workspace URIs stored in conversation database.
 * @param {string} workspaceUrisJson
 * @returns {string}
 */
function extractProjectName(workspaceUrisJson) {
    if (!workspaceUrisJson || typeof workspaceUrisJson !== 'string') return '独立对话';
    try {
        const parsed = JSON.parse(workspaceUrisJson);
        if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'string') {
            const cleanUri = decodeURIComponent(parsed[0].replace(/^file:\/\/\/?/i, ''));
            const normalized = cleanUri.replace(/\\/g, '/').replace(/\/+$/, '');
            const base = path.basename(normalized);
            if (base && base !== '.' && base !== '/') return base;
        }
    } catch (_) {}
    return '独立对话';
}

/**
 * Query recent conversations and their execution statuses from SQLite database.
 * @param {number} [limit=15]
 * @returns {Array<Object>}
 */
function fetchActiveConversations(limit = 15) {
    const dbPath = resolveDatabasePath();
    if (!dbPath || !DatabaseSync) return [];

    try {
        const db = new DatabaseSync(dbPath, { open: true, readOnly: true });
        try {
            const stmt = db.prepare(`
                SELECT conversation_id, title, preview, step_count, status, not_fully_idle, last_modified_time, workspace_uris
                FROM conversation_summaries
                ORDER BY last_modified_time DESC
                LIMIT ?
            `);
            const rows = stmt.all(limit);
            const results = [];

            for (const r of rows) {
                const projectName = extractProjectName(r.workspace_uris);
                let title = (r.title || '').trim();
                if (!title && r.preview) {
                    const lines = r.preview.split('\n').map(l => l.trim()).filter(Boolean);
                    title = lines[0] ? lines[0].slice(0, 40) : '当前任务';
                }
                if (!title) title = '当前任务';

                const isWorking = (r.status === 'CASCADE_RUN_STATUS_RUNNING') || (r.not_fully_idle === 1);
                results.push({
                    convId: r.conversation_id,
                    title,
                    projectName,
                    isWorking,
                    status: r.status || '',
                    notFullyIdle: r.not_fully_idle === 1,
                    stepCount: typeof r.step_count === 'number' ? r.step_count : 0,
                    lastModified: r.last_modified_time ? String(r.last_modified_time) : ''
                });
            }
            return results;
        } finally {
            db.close();
        }
    } catch (_) {
        return [];
    }
}

/**
 * Read conversation turns from transcript file with fast tail buffering.
 * @param {string} convId
 * @param {number} [maxTailBytes=524288] Buffer tail up to 512KB for efficiency
 * @returns {Array<Object>}
 */
function getTranscriptTurns(convId, maxTailBytes = 524288) {
    const filePath = resolveTranscriptPath(convId);
    if (!filePath) return [];

    try {
        const stat = fs.statSync(filePath);
        let content = '';

        if (stat.size <= maxTailBytes) {
            content = fs.readFileSync(filePath, 'utf8');
        } else {
            const buffer = Buffer.alloc(maxTailBytes);
            const fd = fs.openSync(filePath, 'r');
            fs.readSync(fd, buffer, 0, maxTailBytes, stat.size - maxTailBytes);
            fs.closeSync(fd);
            content = buffer.toString('utf8');
            const firstNl = content.indexOf('\n');
            if (firstNl !== -1) {
                content = content.slice(firstNl + 1);
            }
        }

        const parseLines = (rawText) => {
            const lines = rawText.trim().split('\n');
            const turns = [];
            let currentAssistantTurn = null;

            for (const line of lines) {
                if (!line.trim()) continue;
                let step = null;
                try {
                    step = JSON.parse(line.trim());
                } catch (_) {
                    continue;
                }

                if (step.type === 'USER_INPUT') {
                    if (currentAssistantTurn) {
                        turns.push(currentAssistantTurn);
                        currentAssistantTurn = null;
                    }
                    turns.push({
                        role: 'user',
                        id: `turn-u-${convId}-${step.step_index || turns.length}`,
                        text: typeof step.content === 'string' ? step.content : '',
                        stepIndex: step.step_index
                    });
                } else if (step.type === 'PLANNER_RESPONSE') {
                    if (!currentAssistantTurn) {
                        currentAssistantTurn = {
                            role: 'assistant',
                            id: `turn-a-${convId}-${step.step_index || turns.length}`,
                            text: '',
                            tools: [],
                            artifacts: [],
                            isThinking: false,
                            stepIndex: step.step_index
                        };
                    }
                    if (typeof step.content === 'string' && step.content) {
                        currentAssistantTurn.text = step.content;
                    }
                    if (step.thinking && !step.content) {
                        currentAssistantTurn.isThinking = (step.status !== 'DONE' && step.status !== 'ERROR');
                    }
                    if (Array.isArray(step.tool_calls)) {
                        for (const tc of step.tool_calls) {
                            currentAssistantTurn.tools.push({
                                name: tc.name || tc.tool_name || 'tool',
                                status: step.status === 'DONE' ? 'completed' : 'running',
                                args: tc.args
                            });
                        }
                    }
                    if (Array.isArray(step.media)) {
                        for (const m of step.media) {
                            currentAssistantTurn.artifacts.push({
                                uri: m.uri,
                                canProceed: false,
                                proceeded: true
                            });
                        }
                    }
                }
            }

            if (currentAssistantTurn) {
                turns.push(currentAssistantTurn);
            }
            return turns;
        };

        let parsedTurns = parseLines(content);

        // Fallback recovery: If buffer tail does not contain any user turn and file is larger,
        // expand reading window to avoid dropping current user turn for long command outputs.
        const hasUserTurn = parsedTurns.some(t => t.role === 'user');
        if (!hasUserTurn && stat.size > maxTailBytes && stat.size < 10485760) {
            try {
                const fullContent = fs.readFileSync(filePath, 'utf8');
                const fullTurns = parseLines(fullContent);
                if (fullTurns.length > 0) {
                    parsedTurns = fullTurns;
                }
            } catch (_) {}
        }

        return parsedTurns;
    } catch (_) {
        return [];
    }
}

/**
 * Inspect last turn details including pending question, plan proceed, and cancellation.
 * @param {string} convId
 * @param {Array<Object>} [cachedTurns]
 * @returns {{ pendingQuestion: boolean, hasPendingProceed: boolean, isCancelled: boolean }}
 */
function inspectTurnStatusFlags(convId, cachedTurns = null) {
    const turns = cachedTurns || getTranscriptTurns(convId);
    let pendingQuestion = false;
    let hasPendingProceed = false;
    let isCancelled = false;

    if (!turns || turns.length === 0) {
        return { pendingQuestion, hasPendingProceed, isCancelled };
    }

    let lastUserTurn = null;
    let lastModelTurn = null;
    let lastUserIdx = -1;
    let lastModelIdx = -1;

    for (let i = turns.length - 1; i >= 0; i--) {
        if (!lastModelTurn && turns[i].role === 'assistant') {
            lastModelTurn = turns[i];
            lastModelIdx = i;
        }
        if (!lastUserTurn && turns[i].role === 'user') {
            lastUserTurn = turns[i];
            lastUserIdx = i;
        }
        if (lastModelTurn && lastUserTurn) break;
    }

    if (lastModelTurn) {
        if (Array.isArray(lastModelTurn.tools)) {
            const hasQuestionTool = lastModelTurn.tools.some(t => t.name === 'ask_question');
            if (hasQuestionTool && (!lastUserTurn || lastModelIdx > lastUserIdx)) {
                pendingQuestion = true;
            }
        }

        if (Array.isArray(lastModelTurn.artifacts)) {
            hasPendingProceed = lastModelTurn.artifacts.some(a => a.canProceed && !a.proceeded);
        }
    }

    return { pendingQuestion, hasPendingProceed, isCancelled };
}

/**
 * Determine authoritative execution state of a conversation by reconciling
 * stale SQLite database metadata against real-time JSONL transcript logs.
 * Resolves edge-cases where background tasks genuinely complete but SQLite remains in RUNNING
 * until user actively clicks into the conversation tab.
 * @param {Object} convMetadata Conversation summary record from DB
 * @param {Array<Object>} [cachedTurns] Optional pre-loaded transcript turns
 * @returns {boolean} True if actively executing, false if settled/idle
 */
function isConversationActivelyWorking(convMetadata, cachedTurns = null) {
    const rawWorking = Boolean(convMetadata && convMetadata.isWorking);
    const convId = convMetadata && convMetadata.convId;
    const turns = cachedTurns || (convId ? getTranscriptTurns(convId) : []);

    if (!turns || turns.length === 0) {
        return rawWorking;
    }

    let lastUserTurn = null;
    let lastModelTurn = null;
    let lastUserIdx = -1;
    let lastModelIdx = -1;

    for (let i = turns.length - 1; i >= 0; i--) {
        if (!lastModelTurn && turns[i].role === 'assistant') {
            lastModelTurn = turns[i];
            lastModelIdx = i;
        }
        if (!lastUserTurn && turns[i].role === 'user') {
            lastUserTurn = turns[i];
            lastUserIdx = i;
        }
        if (lastModelTurn && lastUserTurn) break;
    }

    // 1. User turn exists but assistant turn has not responded yet: Actively working
    if (lastUserTurn && (!lastModelTurn || lastUserIdx > lastModelIdx)) {
        return true;
    }

    // 2. Assistant turn exists
    if (lastModelTurn) {
        // Assistant is still actively thinking
        if (lastModelTurn.isThinking) {
            return true;
        }

        // Assistant has incomplete/running background tools (except interactive ask_question)
        if (Array.isArray(lastModelTurn.tools) && lastModelTurn.tools.some(t => t.status === 'running' && t.name !== 'ask_question')) {
            return true;
        }

        // Empty assistant turn with no tools, artifacts, or text: Still initializing
        const hasText = typeof lastModelTurn.text === 'string' && lastModelTurn.text.trim().length > 0;
        const hasTools = Array.isArray(lastModelTurn.tools) && lastModelTurn.tools.length > 0;
        const hasArtifacts = Array.isArray(lastModelTurn.artifacts) && lastModelTurn.artifacts.length > 0;
        if (!hasText && !hasTools && !hasArtifacts) {
            return true;
        }

        // All tools completed, output present, not thinking: Task has genuinely finished its run!
        // Override stale database status (e.g. CASCADE_RUN_STATUS_RUNNING delayed write)
        return false;
    }

    return rawWorking;
}

module.exports = {
    resolveDatabasePath,
    resolveTranscriptPath,
    extractProjectName,
    fetchActiveConversations,
    getTranscriptTurns,
    inspectTurnStatusFlags,
    isConversationActivelyWorking
};
