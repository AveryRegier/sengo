// Script to check for case-only filename mismatches in the workspace (useful for Windows devs)
// Usage: node ./scripts/check-case-mismatches.js

const fs = require('fs');
const path = require('path');

function walk(dir, allFiles = []) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) {
      walk(full, allFiles);
    } else {
      allFiles.push(full);
    }
  }
  return allFiles;
}

function groupByLowercase(files) {
  const map = new Map();
  for (const file of files) {
    const lower = file.toLowerCase();
    if (!map.has(lower)) map.set(lower, []);
    map.get(lower).push(file);
  }
  return map;
}

const root = path.resolve(__dirname, '..');
const allFiles = walk(root);
const grouped = groupByLowercase(allFiles);

let found = false;
for (const [lower, files] of grouped.entries()) {
  if (files.length > 1) {
    // Only warn if there are files with the same name but different case
    const unique = Array.from(new Set(files));
    if (unique.length > 1) {
      found = true;
      console.log('Case mismatch detected:');
      for (const f of unique) {
        console.log('  ' + f);
      }
      console.log('');
    }
  }
}

if (!found) {
  console.log('No case-only filename mismatches found.');
  process.exit(0);
} else {
  process.exit(1);
}
