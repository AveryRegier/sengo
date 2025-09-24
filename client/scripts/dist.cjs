const fs = require('fs');
const path = require('path');

const packageJson = require('../package.json');

// Fields to include in the dist/package.json
const pkg = packageJson;

const distPackageJson = {
  name: pkg.name,
  version: pkg.version,
  description: pkg.description,
  author: pkg.author,
  license: pkg.license,
  keywords: pkg.keywords,
  type: pkg.type,
  main: pkg.main?.replace('/build-cjs', ''),
  types: pkg.types?.replace('/build-cjs', ''),
  module: pkg.module?.replace('/build-cjs', ''),
  exports: {
    '.': {
      // import: pkg.exports['.'].import?.replace('/build', ''),
      require: pkg.exports['.'].require?.replace('/build-cjs', '')
    }
  },
  dependencies: pkg.dependencies,
  peerDependencies: pkg.peerDependencies
};

const distPath = path.join(__dirname, '../dist/package.json');
// Create dist directory if it doesn't exist
if (!fs.existsSync(path.dirname(distPath))) {
  fs.mkdirSync(path.dirname(distPath), { recursive: true });
}

fs.writeFileSync(distPath, JSON.stringify(distPackageJson, null, 2));
console.log('package.json copied to dist directory with corrected paths');

// copy all /build to /dist. 
// copy all /build-cjs to /dist/cjs

// Note: This script assumes that the build and build-cjs directories already exist.
function copyDir(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });  
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(srcPath, destPath);
    else fs.copyFileSync(srcPath, destPath);
  }
}
const clientRoot = path.resolve(__dirname, '..');
const distDir = path.join(clientRoot, 'dist');
// const buildDir = path.join(clientRoot, 'build');
const buildCjsDir = path.join(clientRoot, 'build-cjs');
copyDir(buildCjsDir, distDir);
// copyDir(buildCjsDir, path.join(distDir, 'cjs'));
console.log('Build directories copied to dist directory');

// run npm link in dist directory
const { execSync } = require('child_process');
execSync('npm i', { cwd: distDir, stdio: 'inherit' });
// execSync('npm link clox', { cwd: distDir, stdio: 'inherit' });
execSync('npm link clox ../../../clox/dist --save', { cwd: distDir, stdio: 'inherit' });
console.log('npm link run in dist directory');

execSync('npm ls', { cwd: distDir, stdio: 'inherit' });
