#!/usr/bin/env node
// Build a clean distributable for the sengo client: code + minimal package.json (CommonJS version)
const fs = require('fs');
const path = require('path');
const semver = require('semver');

const clientRoot = __dirname;
const distDir = path.resolve(__dirname, 'dist');
const buildDir = path.join(clientRoot, 'build');
const buildCjsDir = path.join(clientRoot, 'build-cjs');
const typesDir = path.join(clientRoot, 'build', 'types');
const pkgPath = path.join(clientRoot, 'package.json');

// Clean dist dir
if (fs.existsSync(distDir)) fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir);

// Copy build output
function copyDir(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(srcPath, destPath);
    else fs.copyFileSync(srcPath, destPath);
  }
}
copyDir(buildDir, path.join(distDir, 'build'));
copyDir(buildCjsDir, path.join(distDir, 'build-cjs'));
copyDir(typesDir, path.join(distDir, 'build', 'types'));

// Parse bump argument (e.g., --bump=patch)
const bumpArg = process.argv.find(arg => arg.startsWith('--bump='));
const bumpType = bumpArg ? bumpArg.split('=')[1] : null;

// Write minimal package.json
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
let version = semver.valid(pkg.version) ? semver.clean(pkg.version) : '1.0.0';
if (bumpType && ['patch', 'minor', 'major'].includes(bumpType)) {
  const newVersion = semver.inc(version, bumpType);
  if (newVersion) {
    version = newVersion;
    pkg.version = newVersion;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
    console.log(`Bumped version to ${newVersion}`);
  }
}
const minimalPkg = {
  name: pkg.name,
  version,
  description: pkg.description,
  type: pkg.type,
  main: pkg.main,
  module: pkg.module,
  exports: pkg.exports,
  types: pkg.types,
  // Only include runtime dependencies, not build tools like semver
  dependencies: Object.fromEntries(Object.entries(pkg.dependencies || {}).filter(([k]) => k !== 'semver')),
  peerDependencies: pkg.peerDependencies,
  keywords: pkg.keywords,
  author: pkg.author,
  license: pkg.license
};
fs.writeFileSync(path.join(distDir, 'package.json'), JSON.stringify(minimalPkg, null, 2));

console.log('Sengo client distribution built at', distDir);
