import * as vscode from 'vscode';
import * as utils from './utils';
import simpleGit, { SimpleGit } from 'simple-git';

let timeout: NodeJS.Timeout | undefined;
let lastCommitMessage: string = '';

export function activate(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration('autoCommitPush');
    const timeoutMinutes = config.get<number>('timeoutMinutes', 10);
    lastCommitMessage = config.get<string>('defaultCommitMessage', 'Auto-save changes');

    // Start the initial timer
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
                vscode.window.showInformationMessage(`Commit message updated: ${lastCommitMessage}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('autoCommitPush.triggerNow', () => {
            commitAndPushChanges();
        })
    );

    // Reset timer on editor changes
    vscode.window.onDidChangeActiveTextEditor(() => resetTimer());
    vscode.workspace.onDidChangeTextDocument(() => resetTimer());

    function resetTimer() {
        if (timeout) {
            clearTimeout(timeout);
        }
        timeout = setTimeout(commitAndPushChanges, timeoutMinutes * 60 * 1000);
    }

    async function commitAndPushChanges() {
        try {
            const rootPath = utils.getWorkspaceRoot();
            if (!rootPath) return;

            const git: SimpleGit = simpleGit(rootPath);
            
            // Check for changes
            const status = await git.status();
            if (status.files.length === 0) return;

            // Stage and commit
            await git.add('.');
            await git.commit(lastCommitMessage);
            
            // Push
            await git.push();
            
            if (config.get<boolean>('enableNotifications', true)) {
                vscode.window.showInformationMessage(
                    `Changes committed & pushed: ${lastCommitMessage}`
                );
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(
                `Auto Commit/Push failed: ${error.message}`
            );
        } finally {
            resetTimer();
        }
    }
}

export function deactivate() {
    if (timeout) {
        clearTimeout(timeout);
    }
}