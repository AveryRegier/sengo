#!/usr/bin/env node
// Rewrites extensionless relative imports/exports in .js files to .js in the build output
const fs = require('fs');
const path = require('path');

function rewriteFileExtensions(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      rewriteFileExtensions(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      // Replace extensionless relative imports/exports with .js
      content = content.replace(/(from\s+['"]\.\.?\/[^'".]+)(['"])/g, '$1.js$2');
      content = content.replace(/(export\s+\{[^}]+\}\s+from\s+['"]\.\.?\/[^'".]+)(['"])/g, '$1.js$2');
      fs.writeFileSync(fullPath, content, 'utf8');
    }
  }
}

const buildDir = path.resolve(__dirname, 'build');
rewriteFileExtensions(buildDir);
