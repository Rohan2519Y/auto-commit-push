import * as vscode from 'vscode';
import * as utils from './utils';
import simpleGit, { SimpleGit, StatusResult, PushResult } from 'simple-git';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';

interface ExtensionConfig {
  timeoutMinutes: number;
  defaultCommitMessage: string;
  enableNotifications: boolean;
}

interface AutoCommitProcess {
  folder: string;
  process: any;
  outputChannel: vscode.OutputChannel;
}

let timeout: NodeJS.Timeout | undefined;
let lastCommitMessage: string = '';
let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;
let nextCommitTime: Date | undefined;
let countdownInterval: NodeJS.Timeout | undefined;
let lastActivityTime: number = Date.now();
let backgroundInterval: NodeJS.Timeout | undefined;
let activeProcesses: Map<string, AutoCommitProcess> = new Map();

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

function startBackgroundMonitoring(getConfig: () => ExtensionConfig, commitAndPushChanges: () => Promise<void>) {
  // Clear existing background interval if any
  if (backgroundInterval) {
    clearInterval(backgroundInterval);
  }

  // Set up interval to check for timeout every 30 seconds
  backgroundInterval = setInterval(() => {
    const config = getConfig();
    const now = Date.now();
    const timeSinceLastActivity = now - lastActivityTime;
    const timeoutMs = config.timeoutMinutes * 60 * 1000;

    if (timeSinceLastActivity >= timeoutMs) {
      logMessage(`Background timeout reached (${config.timeoutMinutes} minutes of inactivity)`);
      commitAndPushChanges();
    }
  }, 30000); // Check every 30 seconds

  return backgroundInterval;
}

async function startAutoCommitForFolder(folderPath: string) {
  try {
    // Check if already running for this folder
    if (activeProcesses.has(folderPath)) {
      vscode.window.showInformationMessage(`Auto-commit already running for: ${path.basename(folderPath)}`);
      return;
    }

    // Check if it's a git repository
    const git = simpleGit(folderPath);
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      vscode.window.showErrorMessage(`${path.basename(folderPath)} is not a git repository`);
      return;
    }

    // Create output channel for this folder
    const outputChannel = vscode.window.createOutputChannel(`Auto-Commit: ${path.basename(folderPath)}`);
    
    // Start the background script for this folder
    const scriptPath = path.join(__dirname, '..', 'auto-commit-global.js');
    const childProcess = spawn('node', [scriptPath, folderPath], {
      cwd: __dirname,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Handle output
    childProcess.stdout.on('data', (data) => {
      outputChannel.append(data.toString());
    });

    childProcess.stderr.on('data', (data) => {
      outputChannel.appendLine(`Error: ${data.toString()}`);
    });

    childProcess.on('close', (code) => {
      outputChannel.appendLine(`Process ended with code ${code}`);
      activeProcesses.delete(folderPath);
    });

    // Store the process
    activeProcesses.set(folderPath, {
      folder: folderPath,
      process: childProcess,
      outputChannel: outputChannel
    });

    outputChannel.show();
    vscode.window.showInformationMessage(`Started auto-commit for: ${path.basename(folderPath)}`);

  } catch (error: any) {
    vscode.window.showErrorMessage(`Failed to start auto-commit: ${error.message}`);
  }
}

async function stopAutoCommitForFolder(folderPath: string) {
  const process = activeProcesses.get(folderPath);
  if (!process) {
    vscode.window.showInformationMessage(`No auto-commit process found for: ${path.basename(folderPath)}`);
    return;
  }

  try {
    process.process.kill();
    process.outputChannel.appendLine('Process stopped by user');
    activeProcesses.delete(folderPath);
    vscode.window.showInformationMessage(`Stopped auto-commit for: ${path.basename(folderPath)}`);
  } catch (error: any) {
    vscode.window.showErrorMessage(`Failed to stop auto-commit: ${error.message}`);
  }
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

  // Start background monitoring
  const backgroundInterval = startBackgroundMonitoring(getConfig, commitAndPushChanges);
  context.subscriptions.push({
    dispose: () => {
      if (backgroundInterval) {
        clearInterval(backgroundInterval);
      }
    }
  });

  // Start initial timer
  resetTimer();

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

  // Register context menu commands
  context.subscriptions.push(
    vscode.commands.registerCommand('autoCommitPush.startForFolder', async (uri: vscode.Uri) => {
      if (uri && uri.fsPath) {
        await startAutoCommitForFolder(uri.fsPath);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('autoCommitPush.stopForFolder', async (uri: vscode.Uri) => {
      if (uri && uri.fsPath) {
        await stopAutoCommitForFolder(uri.fsPath);
      }
    })
  );

  // Track user activity with more comprehensive event listeners
  const activityEvents = [
    vscode.window.onDidChangeActiveTextEditor,
    vscode.workspace.onDidChangeTextDocument,
    vscode.window.onDidChangeWindowState,
    vscode.window.onDidChangeTextEditorSelection,
    vscode.window.onDidChangeTextEditorVisibleRanges,
    vscode.workspace.onDidSaveTextDocument,
    vscode.workspace.onDidCreateFiles,
    vscode.workspace.onDidDeleteFiles,
    vscode.workspace.onDidRenameFiles
  ];

  activityEvents.forEach(event => {
    context.subscriptions.push(event(() => {
      logMessage('User activity detected - resetting timer');
      lastActivityTime = Date.now();
      resetTimer();
    }));
  });

  // Handle window focus events specifically
  context.subscriptions.push(vscode.window.onDidChangeWindowState((e) => {
    if (e.focused) {
      logMessage('Window focused - checking for missed commits');
      // When window becomes focused, check if we missed any commits
      const config = getConfig();
      const now = Date.now();
      const timeSinceLastActivity = now - lastActivityTime;
      const timeoutMs = config.timeoutMinutes * 60 * 1000;

      if (timeSinceLastActivity >= timeoutMs) {
        logMessage('Window focused after timeout period - triggering commit');
        commitAndPushChanges();
      } else {
        logMessage('Window focused - updating display');
        updateCountdownDisplay();
      }
    } else {
      logMessage('Window lost focus - continuing background monitoring');
    }
  }));

  // Handle configuration changes
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('autoCommitPush')) {
      const newConfig = getConfig();
      logMessage('Configuration changed - resetting timer');
      lastCommitMessage = newConfig.defaultCommitMessage;
      resetTimer();
    }
  }));

  function getConfig(): ExtensionConfig {
    const config = vscode.workspace.getConfiguration('autoCommitPush');
    return {
      timeoutMinutes: config.get<number>('timeoutMinutes', 1),
      defaultCommitMessage: config.get<string>('defaultCommitMessage', 'Auto-save changes'),
      enableNotifications: config.get<boolean>('enableNotifications', true)
    };
  }

  function resetTimer() {
    const config = getConfig();
    
    if (timeout) {
      clearTimeout(timeout);
      logMessage('Cleared existing timer');
    }

    // Update last activity time
    lastActivityTime = Date.now();

    // Calculate next commit time
    nextCommitTime = new Date(Date.now() + config.timeoutMinutes * 60_000);
    updateCountdownDisplay();

    timeout = setTimeout(() => {
      logMessage(`Timeout reached (${config.timeoutMinutes} minutes)`);
      commitAndPushChanges();
    }, config.timeoutMinutes * 60_000);

    logMessage(`New timer set for ${config.timeoutMinutes} minutes`);
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
        resetTimer();
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
    } finally {
      resetTimer();
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
  if (timeout) {
    clearTimeout(timeout);
  }
  if (countdownInterval) {
    clearInterval(countdownInterval);
  }
  if (backgroundInterval) {
    clearInterval(backgroundInterval);
  }
  
  // Stop all active processes
  activeProcesses.forEach((process, folder) => {
    try {
      process.process.kill();
    } catch (error) {
      // Ignore errors when stopping processes
    }
  });
  activeProcesses.clear();
  
  if (outputChannel) {
    outputChannel.appendLine('Extension deactivated');
    outputChannel.dispose();
  }
}