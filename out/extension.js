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
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
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
exports.deactivate = exports.activate = void 0;
const vscode = __importStar(require("vscode"));
const utils = __importStar(require("./utils"));
const simple_git_1 = __importDefault(require("simple-git"));
let timeout;
let lastCommitMessage = '';
function activate(context) {
    const config = vscode.workspace.getConfiguration('autoCommitPush');
    const timeoutMinutes = config.get('timeoutMinutes', 10);
    lastCommitMessage = config.get('defaultCommitMessage', 'Auto-save changes');
    // Start the initial timer
    resetTimer();
    // Register commands
    context.subscriptions.push(vscode.commands.registerCommand('autoCommitPush.updateCommitMessage', () => __awaiter(this, void 0, void 0, function* () {
        const newMessage = yield vscode.window.showInputBox({
            prompt: 'Enter new commit message',
            value: lastCommitMessage
        });
        if (newMessage) {
            lastCommitMessage = newMessage;
            vscode.window.showInformationMessage(`Commit message updated: ${lastCommitMessage}`);
        }
    })));
    context.subscriptions.push(vscode.commands.registerCommand('autoCommitPush.triggerNow', () => {
        commitAndPushChanges();
    }));
    // Reset timer on editor changes
    vscode.window.onDidChangeActiveTextEditor(() => resetTimer());
    vscode.workspace.onDidChangeTextDocument(() => resetTimer());
    function resetTimer() {
        if (timeout) {
            clearTimeout(timeout);
        }
        timeout = setTimeout(commitAndPushChanges, timeoutMinutes * 60 * 1000);
    }
    function commitAndPushChanges() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const rootPath = utils.getWorkspaceRoot();
                if (!rootPath)
                    return;
                const git = (0, simple_git_1.default)(rootPath);
                // Check for changes
                const status = yield git.status();
                if (status.files.length === 0)
                    return;
                // Stage and commit
                yield git.add('.');
                yield git.commit(lastCommitMessage);
                // Push
                yield git.push();
                if (config.get('enableNotifications', true)) {
                    vscode.window.showInformationMessage(`Changes committed & pushed: ${lastCommitMessage}`);
                }
            }
            catch (error) {
                vscode.window.showErrorMessage(`Auto Commit/Push failed: ${error.message}`);
            }
            finally {
                resetTimer();
            }
        });
    }
}
exports.activate = activate;
function deactivate() {
    if (timeout) {
        clearTimeout(timeout);
    }
}
exports.deactivate = deactivate;
//# sourceMappingURL=extension.js.map