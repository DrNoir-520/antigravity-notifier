// test/test_ascii_comments.js
// Validates that all source code files contain strictly ASCII English comments.
// English comments only.

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const projectRoot = path.join(__dirname, '..');
const dirsToCheck = ['src', 'bin', 'test', 'scripts'];
const commentRegex = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g;

let violationsCount = 0;

function checkFile(filePath) {
    if (!filePath.endsWith('.js') && !filePath.endsWith('.ps1') && !filePath.endsWith('.vbs')) return;
    const content = fs.readFileSync(filePath, 'utf8');
    let match;
    while ((match = commentRegex.exec(content)) !== null) {
        const comment = match[0];
        if (/[^\x00-\x7F]/.test(comment)) {
            console.error(`❌ Non-ASCII comment found in ${path.relative(projectRoot, filePath)}:`);
            console.error(`   - ${comment.slice(0, 100)}`);
            violationsCount++;
        }
    }
}

function traverseDir(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            traverseDir(fullPath);
        } else if (entry.isFile()) {
            checkFile(fullPath);
        }
    }
}

console.log('🧪 Checking English-only ASCII comments in antigravity-notifier...');
for (const dir of dirsToCheck) {
    traverseDir(path.join(projectRoot, dir));
}

if (violationsCount > 0) {
    console.error(`\n❌ Found ${violationsCount} non-ASCII comment violations.`);
    process.exit(1);
} else {
    console.log('  ✅ 100% ASCII English comments compliance verified across all source files!\n');
}
