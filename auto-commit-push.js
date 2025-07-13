const simpleGit = require('simple-git');
const path = require('path');
const fs = require('fs');

const repoPath = process.cwd();
const git = simpleGit(repoPath);
const commitMessage = 'Auto-commit (background)';
const intervalMinutes = 1;

async function autoCommitPush() {
  try {
    // Check if this is a git repo
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      console.log('Not a git repository:', repoPath);
      return;
    }

    // Check for changes
    const status = await git.status();
    if (status.files.length === 0) {
      console.log(`[${new Date().toLocaleTimeString()}] No changes to commit.`);
      return;
    }

    // Stage all changes
    await git.add('.');
    // Commit
    await git.commit(commitMessage);
    // Push
    await git.push();
    console.log(`[${new Date().toLocaleTimeString()}] Changes committed and pushed.`);
  } catch (err) {
    console.error(`[${new Date().toLocaleTimeString()}] Error:`, err.message);
  }
}

console.log(`Starting auto-commit-push background script in ${repoPath}`);
console.log(`Will commit and push every ${intervalMinutes} minute(s).`);

setInterval(autoCommitPush, intervalMinutes * 60 * 1000);
// Run immediately on start
autoCommitPush(); 