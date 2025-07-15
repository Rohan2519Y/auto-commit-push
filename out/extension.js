"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const utils = __importStar(require("./utils"));
const simple_git_1 = __importDefault(require("simple-git"));
let intervalTimer;
let lastCommitMessage = '';
let outputChannel;
let statusBarItem;
let nextCommitTime;
let countdownInterval;
function createOutputChannel() {
    if (!outputChannel) {
        outputChannel = vscode.window.createOutputChannel('Auto Commit/Push');
    }
}
function logMessage(message, isError = false) {
    createOutputChannel();
    const config = vscode.workspace.getConfiguration('autoCommitPush');
    if (isError || config.get('enableDetailedLogging', false)) {
        const timestamp = new Date().toLocaleTimeString();
        outputChannel.appendLine(`[${timestamp}] ${message}`);
        if (isError) {
            console.error(message);
        }
    }
}
function updateCountdownDisplay() {
    if (!nextCommitTime || !statusBarItem) {
        return;
    }
    const now = new Date();
    const diffMs = nextCommitTime.getTime() - now.getTime();
    if (diffMs <= 0) {
        statusBarItem.text = `$(git-commit) Auto-commit: Now!`;
        statusBarItem.tooltip = 'Changes will be committed momentarily';
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        return;
    }
    const diffMins = Math.floor(diffMs / 60000);
    const diffSecs = Math.floor((diffMs % 60000) / 1000);
    statusBarItem.text = `$(git-commit) Auto-commit: ${diffMins}m ${diffSecs}s`;
    statusBarItem.tooltip = `Next auto-commit at ${nextCommitTime.toLocaleTimeString()}`;
    statusBarItem.backgroundColor = undefined;
    statusBarItem.show();
}
function activate(context) {
    createOutputChannel();
    logMessage('Extension activated');
    // Create status bar item for countdown timer
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'autoCommitPush.triggerNow';
    context.subscriptions.push(statusBarItem);
    // Start countdown interval (updates every second)
    countdownInterval = setInterval(updateCountdownDisplay, 1000);
    context.subscriptions.push({
        dispose: () => {
            if (countdownInterval) {
                clearInterval(countdownInterval);
            }
        }
    });
    // Load configuration
    const config = getConfig();
    lastCommitMessage = config.defaultCommitMessage;
    logMessage(`Initial timeout: ${config.timeoutMinutes} minutes`);
    logMessage(`Default commit message: "${lastCommitMessage}"`);
    // Start fixed interval timer (does NOT reset on activity)
    startFixedIntervalTimer();
    // Register commands
    context.subscriptions.push(vscode.commands.registerCommand('autoCommitPush.updateCommitMessage', () => __awaiter(this, void 0, void 0, function* () {
        const newMessage = yield vscode.window.showInputBox({
            prompt: 'Enter new commit message',
            value: lastCommitMessage
        });
        if (newMessage) {
            lastCommitMessage = newMessage;
            showMessage(`Commit message updated: ${lastCommitMessage}`);
        }
    })));
    context.subscriptions.push(vscode.commands.registerCommand('autoCommitPush.triggerNow', () => {
        showMessage('Manual trigger activated');
        commitAndPushChanges();
    }));
    // No event listeners for user activity!
    // Handle configuration changes
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('autoCommitPush')) {
            const newConfig = getConfig();
            logMessage('Configuration changed - restarting timer');
            lastCommitMessage = newConfig.defaultCommitMessage;
            restartFixedIntervalTimer();
        }
    }));
    function getConfig() {
        const config = vscode.workspace.getConfiguration('autoCommitPush');
        return {
            timeoutMinutes: config.get('timeoutMinutes', 10),
            defaultCommitMessage: config.get('defaultCommitMessage', 'Auto-save changes'),
            enableNotifications: config.get('enableNotifications', true),
            enableDetailedLogging: config.get('enableDetailedLogging', false)
        };
    }
    function startFixedIntervalTimer() {
        const config = getConfig();
        if (intervalTimer) {
            clearInterval(intervalTimer);
        }
        setNextCommitTime(config.timeoutMinutes);
        intervalTimer = setInterval(() => {
            setNextCommitTime(config.timeoutMinutes);
            commitAndPushChanges();
        }, config.timeoutMinutes * 60000);
        logMessage(`Fixed interval timer started for every ${config.timeoutMinutes} minutes`);
    }
    function restartFixedIntervalTimer() {
        if (intervalTimer) {
            clearInterval(intervalTimer);
        }
        startFixedIntervalTimer();
    }
    function setNextCommitTime(minutes) {
        nextCommitTime = new Date(Date.now() + minutes * 60000);
        updateCountdownDisplay();
    }
    function commitAndPushChanges() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const config = getConfig();
            try {
                logMessage('Starting commit process...');
                const rootPath = utils.getWorkspaceRoot();
                if (!rootPath) {
                    logMessage('No workspace folder open - aborting');
                    return;
                }
                logMessage(`Workspace root: ${rootPath}`);
                const git = (0, simple_git_1.default)(rootPath);
                logMessage('Git instance created');
                // Check if git repo
                if (!(yield git.checkIsRepo())) {
                    showMessage('Not a Git repository - aborting', true);
                    return;
                }
                // Check for changes
                const status = yield git.status();
                logMessage(`Git status: ${status.files.length} changed files`);
                if (status.files.length === 0) {
                    logMessage('No changes to commit');
                    showMessage('No changes to commit');
                    return;
                }
                // Stage and commit
                logMessage('Staging changes...');
                yield git.add('.');
                logMessage(`Committing with message: "${lastCommitMessage}"`);
                const commit = yield git.commit(lastCommitMessage);
                logMessage(`Commit created: ${commit.commit}`);
                // Push
                logMessage('Pushing changes...');
                const pushResult = yield git.push();
                const pushedCount = ((_a = pushResult.pushed) === null || _a === void 0 ? void 0 : _a.length) || 0;
                logMessage(`Pushed changes successfully. ${pushedCount} commits pushed.`);
                // Show success
                const msg = `Changes committed & pushed: ${lastCommitMessage}`;
                logMessage(msg);
                showMessage(msg);
            }
            catch (error) {
                const errorMsg = `Operation failed: ${error.message}`;
                logMessage(errorMsg, true);
                showMessage(errorMsg, true);
            }
        });
    }
    function showMessage(message, isError = false) {
        const config = getConfig();
        if (config.enableNotifications) {
            if (isError) {
                vscode.window.showErrorMessage(message);
            }
            else {
                vscode.window.showInformationMessage(message);
            }
        }
        logMessage(message, isError);
    }
}
function deactivate() {
    if (intervalTimer) {
        clearInterval(intervalTimer);
    }
    if (countdownInterval) {
        clearInterval(countdownInterval);
    }
    if (outputChannel) {
        outputChannel.appendLine('Extension deactivated');
        outputChannel.dispose();
    }
    if (statusBarItem) {
        statusBarItem.dispose();
    }
}
//# sourceMappingURL=extension.js.map