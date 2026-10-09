// test/test_all.js
// Master unit test runner for antigravity-notifier.
// English comments only.

const assert = require('assert');
const {
    NotificationGateway,
    normalizePushUrl,
    deliverPushNotification,
    formatNotificationTime
} = require('../src/gateway');
const { NotificationService } = require('../src/service');
const { ConfigManager } = require('../src/config');
const { AntigravityMonitor } = require('../src/monitor');

async function runAllTests() {
    console.log('🧪 Starting Antigravity Notifier Master Unit Tests...\n');

    // ---------------------------------------------------------------------------
    // Test Suite 1: Gateway Protocol Normalization & Channel Resolution
    // ---------------------------------------------------------------------------
    console.log('Test Suite 1: Gateway Protocol Normalization & Channel Resolution');
    {
        // Qmsg
        assert.strictEqual(
            normalizePushUrl('qmsg://myKey123'),
            'https://qmsg.zendee.cn/v3/send/myKey123',
            'Qmsg scheme should normalize to v3 endpoint'
        );

        // Bark
        assert.strictEqual(
            normalizePushUrl('abcd1234efgh5678ijkl90'),
            'https://api.day.app/abcd1234efgh5678ijkl90/',
            'Bark key should resolve to standard day.app endpoint'
        );

        // ntfy
        assert.strictEqual(
            normalizePushUrl('ntfy.sh/my-topic'),
            'https://ntfy.sh/my-topic',
            'ntfy without protocol should resolve to https'
        );

        // ServerChan
        assert.strictEqual(
            normalizePushUrl('SCT123456abcdef'),
            'https://sctapi.ftqq.com/SCT123456abcdef.send',
            'ServerChan SendKey should resolve to sctapi endpoint'
        );

        console.log('  ✅ [PASS] All channel URL formats normalized correctly');
    }

    // ---------------------------------------------------------------------------
    // Test Suite 2: Notification Title Formatting and 3-Status Support
    // ---------------------------------------------------------------------------
    console.log('\nTest Suite 2: Notification Title Formatting and 3-Status Support');
    {
        let capturedCall = null;
        const mockFetch = async (url, opts) => {
            capturedCall = { url, opts };
            return { ok: true, status: 200, text: async () => '{"code":0,"msg":"success"}' };
        };

        const gateway = new NotificationGateway(
            { pushUrl: 'qmsg://mockKey' },
            { fetchFn: mockFetch }
        );

        // 1. Completed status
        await gateway.notifyTaskEvent({
            convTitle: '代码重构',
            projectName: 'AGY',
            isPlanApprovalPending: false,
            isQuestionPending: false,
            message: '重构完成'
        });
        assert(capturedCall, 'Mock fetch should be invoked');
        assert(decodeURIComponent(capturedCall.opts.body).includes('代码重构（AGY）已完成'),
            'Title should format with 已完成 status');

        // 2. Question pending status
        await gateway.notifyTaskEvent({
            convTitle: '代码重构',
            projectName: 'AGY',
            isPlanApprovalPending: false,
            isQuestionPending: true,
            message: '请选择架构方案'
        });
        assert(decodeURIComponent(capturedCall.opts.body).includes('代码重构（AGY）待输入'),
            'Title should format with 待输入 status');

        // 3. Plan approval status
        await gateway.notifyTaskEvent({
            convTitle: '代码重构',
            projectName: 'AGY',
            isPlanApprovalPending: true,
            isQuestionPending: false,
            message: '请审批方案'
        });
        assert(decodeURIComponent(capturedCall.opts.body).includes('代码重构（AGY）待确认'),
            'Title should format with 待确认 status');

        // 4. Cancelled status
        await gateway.notifyTaskEvent({
            convTitle: '代码重构',
            projectName: 'AGY',
            isCancelled: true,
            isPlanApprovalPending: false,
            isQuestionPending: false,
            message: '用户中断了任务'
        });
        assert(decodeURIComponent(capturedCall.opts.body).includes('代码重构（AGY）已中断'),
            'Title should format with 已中断 status');

        console.log('  ✅ [PASS] Titles formatted with accurate status (已完成 / 待输入 / 待确认 / 已中断)');
    }

    // ---------------------------------------------------------------------------
    // Test Suite 3: Task Lifecycle State Machine & Settling Debounce
    // ---------------------------------------------------------------------------
    console.log('\nTest Suite 3: Task Lifecycle State Machine & Settling Debounce');
    {
        let sentCount = 0;
        const mockGateway = {
            notifyTaskEvent: async () => {
                sentCount++;
                return { ok: true };
            },
            formatCompletionTitle: (title, proj, isPlan, explicit, isQ) => `${title} status`
        };

        const service = new NotificationService({
            config: { enabled: true, pushUrl: 'qmsg://test', autoApprovePlan: false },
            gateway: mockGateway
        });

        service.armTaskPendingStart('conv-test');
        const state = service.getConvTaskState('conv-test');
        assert.strictEqual(state.status, 'pending_start', 'Task should start in pending_start');

        // Intermediate working state
        service.evaluateConversationTaskLifecycle({
            convId: 'conv-test',
            isWorking: true,
            convTitle: '测试任务',
            projectName: 'AGY',
            pendingQuestion: false,
            pendingPlanProceed: false
        });
        assert.strictEqual(state.status, 'running', 'Task should transition to running');
        assert.strictEqual(sentCount, 0, 'No notification should fire while running');

        console.log('  ✅ [PASS] State machine tracks pending_start and running states');
    }

    // ---------------------------------------------------------------------------
    // Test Suite 4: Auto-Approval Plan Suppression
    // ---------------------------------------------------------------------------
    console.log('\nTest Suite 4: Auto-Approval Plan Suppression');
    {
        const serviceNormal = new NotificationService({
            config: { autoApprovePlan: false }
        });
        assert.strictEqual(serviceNormal.isAutoApprovalEnabled(), false,
            'Auto-approval should be disabled when config is false');

        const serviceAuto = new NotificationService({
            config: { autoApprovePlan: true }
        });
        assert.strictEqual(serviceAuto.isAutoApprovalEnabled(), true,
            'Auto-approval should be enabled when config is true');

        console.log('  ✅ [PASS] Auto-approval suppression configuration verified');
    }

    // ---------------------------------------------------------------------------
    // Test Suite 5: Antigravity Monitor Candidate Port Discovery
    // ---------------------------------------------------------------------------
    console.log('\nTest Suite 5: Antigravity Monitor Candidate Port Discovery');
    {
        const monitor = new AntigravityMonitor();
        const ports = monitor.findCandidatePorts();
        assert(Array.isArray(ports), 'Candidate ports should be an array');
        assert(ports.length > 0, 'Should have candidate ports listed');
        assert(ports.includes(5743), 'Should include standard port 5743');

        console.log('  ✅ [PASS] Monitor candidate port discovery verified');
    }

    // ---------------------------------------------------------------------------
    // Test Suite 6: Question Notification Delay Configuration & Settle Delay
    // ---------------------------------------------------------------------------
    console.log('\nTest Suite 6: Question Notification Delay Configuration & Settle Delay');
    {
        const service = new NotificationService({
            config: { pushNotificationEnabled: true, questionNotificationDelaySeconds: 15 }
        });

        assert.strictEqual(service.getQuestionNotificationDelaySeconds(), 15,
            'Should return configured delay in seconds');
        assert.strictEqual(service.getQuestionNotificationDelayMs(), 15000,
            'Should return configured delay in milliseconds');

        service.setQuestionNotificationDelaySeconds(45);
        assert.strictEqual(service.getQuestionNotificationDelaySeconds(), 45,
            'setQuestionNotificationDelaySeconds should update delay');

        const updated = service.updateSettings({ questionNotificationDelaySeconds: 30 });
        assert.strictEqual(updated.questionNotificationDelaySeconds, 30,
            'updateSettings should update questionNotificationDelaySeconds');

        console.log('  ✅ [PASS] Question notification delay configuration verified');
    }

    // ---------------------------------------------------------------------------
    // Test Suite 7: Native Storage & Transcript Turn Parsing
    // ---------------------------------------------------------------------------
    console.log('\nTest Suite 7: Native Storage & Transcript Turn Parsing');
    {
        const {
            extractProjectName,
            inspectTurnStatusFlags
        } = require('../src/transcript');

        assert.strictEqual(
            extractProjectName('["file:///d%3A/1AWDWJ/Anti/AGY"]'),
            'AGY',
            'extractProjectName should parse decoded project basename'
        );

        assert.strictEqual(
            extractProjectName(''),
            '独立对话',
            'extractProjectName should fallback to standalone conversation'
        );

        const mockTurnsWithQuestion = [
            { role: 'user', id: 'u1', text: 'help' },
            { role: 'assistant', id: 'm1', text: '', tools: [{ name: 'ask_question' }] }
        ];
        const flagsQ = inspectTurnStatusFlags('dummy', mockTurnsWithQuestion);
        assert.strictEqual(flagsQ.pendingQuestion, true, 'Should detect pending question tool call');

        const mockTurnsNormal = [
            { role: 'user', id: 'u1', text: 'help' },
            { role: 'assistant', id: 'm1', text: 'done', tools: [{ name: 'run_command' }] }
        ];
        const flagsNorm = inspectTurnStatusFlags('dummy', mockTurnsNormal);
        assert.strictEqual(flagsNorm.pendingQuestion, false, 'Should not detect pending question on normal tool');

        console.log('  ✅ [PASS] Storage and transcript inspection verified');
    }

    console.log('\n🎉 ALL ANTIGRAVITY NOTIFIER UNIT TESTS PASSED SUCCESSFULLY!\n');
}

runAllTests().catch((err) => {
    console.error('❌ Test suite failed:', err);
    process.exit(1);
});

