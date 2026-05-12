#!/usr/bin/env node
// Validates the inline Babel/JSX script in project/CharacterFeed.html using
// the same @babel/standalone version the browser uses, so this never blocks
// a commit that would actually work (no false positives).
// Exits 1 (blocking the commit) if Babel cannot transform the script.

const fs   = require('fs');
const path = require('path');

// Suppress Babel's "install React DevTools" console noise
const _log = console.log.bind(console);
console.log = (...args) => {
  if (typeof args[0] === 'string' && args[0].includes('Download the React')) return;
  _log(...args);
};

const Babel = require('@babel/standalone');
console.log = _log; // restore

const filePath = path.join(__dirname, '../project/CharacterFeed.html');

if (!fs.existsSync(filePath)) {
  process.stdout.write('check-babel: CharacterFeed.html not found, skipping.\n');
  process.exit(0);
}

const html = fs.readFileSync(filePath, 'utf-8');

// Extract every inline <script type="text/babel"> block
const SCRIPT_RE = /<script\s+type="text\/babel"\s*>([\s\S]*?)<\/script>/gi;
const blocks = [];
let m;
while ((m = SCRIPT_RE.exec(html)) !== null) {
  // Calculate which file line the script starts on
  const startLine = html.slice(0, m.index).split('\n').length + 1;
  blocks.push({ code: m[1], startLine });
}

if (!blocks.length) {
  process.stdout.write('check-babel: no inline Babel blocks found, skipping.\n');
  process.exit(0);
}

let ok = true;
for (const { code, startLine } of blocks) {
  try {
    Babel.transform(code, { presets: ['react'] });
  } catch (e) {
    ok = false;
    const scriptLine = e.loc ? e.loc.line : '?';
    const fileLine   = e.loc ? startLine + e.loc.line - 1 : '?';
    const col        = e.loc ? e.loc.column : '?';
    const msg        = (e.message || '').replace(/^unknown:\s*/i, '').split('\n')[0];
    process.stderr.write(`\nBabel syntax error in CharacterFeed.html\n`);
    process.stderr.write(`  File line ~${fileLine}  (script line ${scriptLine}, col ${col})\n`);
    process.stderr.write(`  ${msg}\n\n`);
  }
}

if (ok) {
  process.stdout.write('check-babel: CharacterFeed.html OK\n');
  process.exit(0);
} else {
  process.stderr.write('Commit blocked. Fix the error above, then commit again.\n');
  process.exit(1);
}
