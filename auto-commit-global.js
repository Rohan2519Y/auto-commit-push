const simpleGit = require('simple-git');
const path = require('path');
const fs = require('fs');

// Get the target directory from command line argument or use current directory
const targetPath = process.argv[2] || process.cwd();
const repoPath = path.resolve(targetPath);
const git = simpleGit(repoPath);
const commitMessage = 'Auto-commit (background)';
const intervalMinutes = 1;

let nextCommitTime = Date.now() + (intervalMinutes * 60 * 1000);

function getTimeRemaining() {
  const now = Date.now();
  const diffMs = nextCommitTime - now;
  
  if (diffMs <= 0) {
    return 'Now!';
  }
  
  const diffMins = Math.floor(diffMs / 60000);
  const diffSecs = Math.floor((diffMs % 60000) / 1000);
  
  return `${diffMins}m ${diffSecs}s`;
}

async function autoCommitPush() {
  try {
    // Check if this is a git repo
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      console.log(`[${new Date().toLocaleTimeString()}] Not a git repository: ${repoPath} | Next: ${getTimeRemaining()}`);
      return;
    }

    // Check for changes
    const status = await git.status();
    if (status.files.length === 0) {
      console.log(`[${new Date().toLocaleTimeString()}] No changes to commit | Next: ${getTimeRemaining()}`);
      return;
    }

    // Stage all changes
    await git.add('.');
    // Commit
    await git.commit(commitMessage);
    // Push
    await git.push();
    console.log(`[${new Date().toLocaleTimeString()}] Changes committed and pushed | Next: ${getTimeRemaining()}`);
  } catch (err) {
    console.error(`[${new Date().toLocaleTimeString()}] Error: ${err.message} | Next: ${getTimeRemaining()}`);
  }
}

console.log(`Starting auto-commit-push background script in ${repoPath}`);
console.log(`Will commit and push every ${intervalMinutes} minute(s).`);

setInterval(() => {
  autoCommitPush();
  nextCommitTime = Date.now() + (intervalMinutes * 60 * 1000);
}, intervalMinutes * 60 * 1000);

// Run immediately on start
autoCommitPush(); 