// src/index.js
// Main entry point for antigravity-notifier package.
// English comments only.

const { NotificationGateway, createNotificationGateway, normalizePushUrl, deliverPushNotification } = require('./gateway');
const { NotificationService } = require('./service');
const { ConfigManager, configManager } = require('./config');
const { AntigravityMonitor } = require('./monitor');
const {
    resolveDatabasePath,
    resolveTranscriptPath,
    extractProjectName,
    fetchActiveConversations,
    getTranscriptTurns,
    inspectTurnStatusFlags
} = require('./transcript');

module.exports = {
    NotificationGateway,
    createNotificationGateway,
    normalizePushUrl,
    deliverPushNotification,
    NotificationService,
    ConfigManager,
    configManager,
    AntigravityMonitor,
    resolveDatabasePath,
    resolveTranscriptPath,
    extractProjectName,
    fetchActiveConversations,
    getTranscriptTurns,
    inspectTurnStatusFlags
};
