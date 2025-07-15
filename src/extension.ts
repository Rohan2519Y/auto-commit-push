import * as vscode from 'vscode';
import * as utils from './utils';
import simpleGit, { SimpleGit, StatusResult, PushResult } from 'simple-git';

interface ExtensionConfig {
  timeoutMinutes: number;
  defaultCommitMessage: string;
  enableNotifications: boolean;
  enableDetailedLogging: boolean;
}

let intervalTimer: NodeJS.Timeout | undefined;
let lastCommitMessage: string = '';
let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;
let nextCommitTime: Date | undefined;
let countdownInterval: NodeJS.Timeout | undefined;

function createOutputChannel() {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('Auto Commit/Push');
  }
}

function logMessage(message: string, isError: boolean = false) {
  createOutputChannel();
  const config = vscode.workspace.getConfiguration('autoCommitPush');
  if (isError || config.get<boolean>('enableDetailedLogging', false)) {
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

export function activate(context: vscode.ExtensionContext) {
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
  context.subscriptions.push(
    vscode.commands.registerCommand('autoCommitPush.updateCommitMessage', async () => {
      const newMessage = await vscode.window.showInputBox({
        prompt: 'Enter new commit message',
        value: lastCommitMessage
      });
      if (newMessage) {
        lastCommitMessage = newMessage;
        showMessage(`Commit message updated: ${lastCommitMessage}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('autoCommitPush.triggerNow', () => {
      showMessage('Manual trigger activated');
      commitAndPushChanges();
    })
  );

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

  function getConfig(): ExtensionConfig {
    const config = vscode.workspace.getConfiguration('autoCommitPush');
    return {
      timeoutMinutes: config.get<number>('timeoutMinutes', 10),
      defaultCommitMessage: config.get<string>('defaultCommitMessage', 'Auto-save changes'),
      enableNotifications: config.get<boolean>('enableNotifications', true),
      enableDetailedLogging: config.get<boolean>('enableDetailedLogging', false)
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
    }, config.timeoutMinutes * 60_000);
    logMessage(`Fixed interval timer started for every ${config.timeoutMinutes} minutes`);
  }

  function restartFixedIntervalTimer() {
    if (intervalTimer) {
      clearInterval(intervalTimer);
    }
    startFixedIntervalTimer();
  }

  function setNextCommitTime(minutes: number) {
    nextCommitTime = new Date(Date.now() + minutes * 60_000);
    updateCountdownDisplay();
  }

  async function commitAndPushChanges() {
    const config = getConfig();
    try {
      logMessage('Starting commit process...');
      const rootPath = utils.getWorkspaceRoot();
      if (!rootPath) {
        logMessage('No workspace folder open - aborting');
        return;
      }
      logMessage(`Workspace root: ${rootPath}`);
      const git: SimpleGit = simpleGit(rootPath);
      logMessage('Git instance created');
      // Check if git repo
      if (!(await git.checkIsRepo())) {
        showMessage('Not a Git repository - aborting', true);
        return;
      }
      // Check for changes
      const status: StatusResult = await git.status();
      logMessage(`Git status: ${status.files.length} changed files`);
      if (status.files.length === 0) {
        logMessage('No changes to commit');
        showMessage('No changes to commit');
        return;
      }
      // Stage and commit
      logMessage('Staging changes...');
      await git.add('.');
      logMessage(`Committing with message: "${lastCommitMessage}"`);
      const commit = await git.commit(lastCommitMessage);
      logMessage(`Commit created: ${commit.commit}`);
      // Push
      logMessage('Pushing changes...');
      const pushResult: PushResult = await git.push();
      const pushedCount = pushResult.pushed?.length || 0;
      logMessage(`Pushed changes successfully. ${pushedCount} commits pushed.`);
      // Show success
      const msg = `Changes committed & pushed: ${lastCommitMessage}`;
      logMessage(msg);
      showMessage(msg);
    } catch (error: any) {
      const errorMsg = `Operation failed: ${error.message}`;
      logMessage(errorMsg, true);
      showMessage(errorMsg, true);
    }
  }

  function showMessage(message: string, isError: boolean = false) {
    const config = getConfig();
    if (config.enableNotifications) {
      if (isError) {
        vscode.window.showErrorMessage(message);
      } else {
        vscode.window.showInformationMessage(message);
      }
    }
    logMessage(message, isError);
  }
}

export function deactivate() {
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