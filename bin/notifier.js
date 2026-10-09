#!/usr/bin/env node
// bin/notifier.js
// Command-line interface and daemon runner for antigravity-notifier.
// English comments only.

const path = require('path');
const { execSync, spawn } = require('child_process');
const { configManager } = require('../src/config');
const { NotificationGateway, deliverPushNotification } = require('../src/gateway');
const { NotificationService } = require('../src/service');
const { AntigravityMonitor } = require('../src/monitor');
const { getTranscriptTurns } = require('../src/transcript');

const args = process.argv.slice(2);
const command = (args[0] || 'start').toLowerCase();

async function runDaemon(isSilent = false) {
    const config = configManager.load();
    if (!config.pushUrl) {
        if (!isSilent) {
            console.log('⚠️ [Warning] No push notification URL configured.');
            console.log('💡 Run: node bin/notifier.js set-push "qmsg://YOUR_KEY" or "https://api.day.app/YOUR_KEY/"');
        }
    } else {
        if (!isSilent) {
            console.log(`📡 Push channel configured: ${config.pushUrl.replace(/([a-zA-Z0-9]{5})[a-zA-Z0-9]+([a-zA-Z0-9]{4})/, '$1***$2')}`);
        }
    }

    const gateway = new NotificationGateway(config);
    const service = new NotificationService({
        config,
        gateway,
        getTranscriptTurns: (convId) => getTranscriptTurns(convId),
        onConfigChange: (newCfg) => configManager.save(newCfg)
    });

    const monitor = new AntigravityMonitor({
        service,
        configManager,
        onStatusChange: (status) => {
            if (isSilent) return;
            if (status.connected) {
                if (status.mode === 'disk') {
                    console.log('🔗 [Connected] Antigravity attached via native storage monitor.');
                } else {
                    console.log(`🔗 [Connected] Antigravity attached on port ${status.port}`);
                }
            } else {
                console.log('⏳ [Waiting] Antigravity not running. Monitoring in background (0% CPU)...');
            }
        }
    });

    if (!isSilent) {
        console.log('🚀 Antigravity Push Notifier is running.');
        console.log('Press Ctrl+C to stop.\n');
    }

    monitor.start();

    // Keep process alive
    process.on('SIGINT', () => {
        if (!isSilent) console.log('\n🛑 Stopping Antigravity Push Notifier...');
        monitor.stop();
        process.exit(0);
    });
    process.on('SIGTERM', () => {
        monitor.stop();
        process.exit(0);
    });
}

async function runTest(testUrl) {
    const config = configManager.getSettings();
    const targetUrl = (testUrl || config.pushUrl || '').trim();

    if (!targetUrl) {
        console.error('❌ Error: No push URL specified.');
        console.log('Usage: node bin/notifier.js test "qmsg://YOUR_KEY"');
        process.exit(1);
    }

    console.log(`🔔 Sending test push notification to: ${targetUrl}`);
    const result = await deliverPushNotification({
        url: targetUrl,
        pushUrl: targetUrl,
        convTitle: '测试会话',
        projectName: 'Antigravity',
        status: '已完成',
        message: '这是一条来自 Antigravity Notifier 的测试通知，通道通信正常！'
    });

    if (result.ok) {
        console.log('✅ Test notification successfully sent! Please check your mobile device.');
    } else {
        console.error(`❌ Failed to deliver test notification: ${result.error || 'Unknown error'}`);
    }
}

function runSetPush(newUrl) {
    if (!newUrl) {
        console.error('❌ Error: Please provide a push URL or Key.');
        console.log('Example: node bin/notifier.js set-push "qmsg://YOUR_KEY"');
        process.exit(1);
    }
    const updated = configManager.updateSettings({ pushUrl: newUrl.trim() });
    console.log('✅ Push notification URL updated successfully:');
    console.log(`   Config saved to: ${configManager.globalConfigFile}`);
    console.log(`   Push URL: ${updated.pushUrl}`);
}

function runSetDelay(secondsStr) {
    const sec = Number(secondsStr);
    if (isNaN(sec) || sec < 0) {
        console.error('❌ Error: Please provide a valid non-negative number of seconds.');
        console.log('Example: node bin/notifier.js set-delay 30');
        process.exit(1);
    }
    const updated = configManager.updateSettings({ questionNotificationDelaySeconds: sec });
    console.log('✅ Question notification delay updated successfully:');
    console.log(`   Config saved to: ${configManager.globalConfigFile}`);
    console.log(`   Question Delay: ${updated.questionNotificationDelaySeconds}s (delay before pushing unanswered questions)`);
}

function runStatus() {
    const config = configManager.getSettings();
    console.log('====================================');
    console.log('  Antigravity Notifier Status');
    console.log('====================================');
    console.log(`• Config file:    ${configManager.globalConfigFile}`);
    console.log(`• Push URL:       ${config.pushUrl || '(Not configured)'}`);
    console.log(`• Enabled:        ${config.enabled !== false ? 'Yes' : 'No'}`);
    console.log(`• Question Delay: ${config.questionNotificationDelaySeconds !== undefined ? config.questionNotificationDelaySeconds : 4}s (wait before push if unanswered)`);
    console.log(`• Auto-Approve:   ${config.autoApprovePlan ? 'Enabled (Silence plan proceed)' : 'Normal (Notify on proceed)'}`);

    // Check if task scheduler task exists
    try {
        const queryRes = execSync('schtasks /query /tn "Antigravity_Notifier" 2>nul', { encoding: 'utf8' });
        if (queryRes.includes('Antigravity_Notifier')) {
            console.log('• Scheduled Task: Active ("Antigravity_Notifier" installed)');
        }
    } catch (e) {
        console.log('• Scheduled Task: Not installed (Run: node bin/notifier.js install)');
    }
}

function runInstall() {
    const scriptPath = path.join(__dirname, '..', 'scripts', 'install-service.ps1');
    console.log('🔧 Installing Windows Scheduled Task "Antigravity_Notifier"...');
    try {
        execSync(`powershell -ExecutionPolicy Bypass -File "${scriptPath}"`, { stdio: 'inherit' });
    } catch (e) {
        console.error('Failed to run install script:', e.message);
    }
}

function runUninstall() {
    const scriptPath = path.join(__dirname, '..', 'scripts', 'uninstall-service.ps1');
    console.log('🧹 Uninstalling Windows Scheduled Task "Antigravity_Notifier"...');
    try {
        execSync(`powershell -ExecutionPolicy Bypass -File "${scriptPath}"`, { stdio: 'inherit' });
    } catch (e) {
        console.error('Failed to run uninstall script:', e.message);
    }
}

function runBackground() {
    const vbsPath = path.join(__dirname, '..', 'scripts', 'run-hidden.vbs');
    console.log('👻 Launching Antigravity Notifier in silent background...');
    try {
        spawn('wscript.exe', ['//B', vbsPath], {
            detached: true,
            stdio: 'ignore'
        }).unref();
        console.log('✅ Background process launched silently with zero windows.');
    } catch (e) {
        console.error('Failed to launch background process:', e.message);
    }
}

function showHelp() {
    console.log(`
Antigravity Push Notifier - Command Line Interface

Usage:
  node bin/notifier.js <command> [options]

Commands:
  start               Start notifier daemon in foreground with console logs
  daemon              Run daemon silently (internal background mode)
  background          Launch stealth background daemon immediately
  test [pushUrl]      Send a test notification to your mobile device
  set-push <pushUrl>  Set or update the push notification URL / Key
  set-delay <sec>     Set delay (seconds) to wait before notifying unanswered questions (e.g. 30)
  status              Check current configuration and service status
  install             Install Windows Scheduled Task for auto-start at logon
  uninstall           Remove Windows Scheduled Task
  help                Show this help message

Examples:
  node bin/notifier.js set-push "qmsg://c1b887b5f9ed73ea0fa1704ed29064bf496bdf33"
  node bin/notifier.js set-delay 30
  node bin/notifier.js test
  node bin/notifier.js install
`);
}

switch (command) {
    case 'start':
        runDaemon(false);
        break;
    case 'daemon':
        runDaemon(true);
        break;
    case 'background':
        runBackground();
        break;
    case 'test':
        runTest(args[1]);
        break;
    case 'set-push':
        runSetPush(args[1]);
        break;
    case 'set-delay':
        runSetDelay(args[1]);
        break;
    case 'status':
        runStatus();
        break;
    case 'install':
        runInstall();
        break;
    case 'uninstall':
        runUninstall();
        break;
    case 'help':
    case '--help':
    case '-h':
        showHelp();
        break;
    default:
        console.error(`Unknown command: ${command}`);
        showHelp();
        process.exit(1);
}
