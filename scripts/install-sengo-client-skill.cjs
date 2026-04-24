#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function fail(msg) {
  console.error(`[sengo-skill-install] ${msg}`);
  process.exit(1);
}

function info(msg) {
  console.log(`[sengo-skill-install] ${msg}`);
}

const repoRoot = path.resolve(__dirname, '..');
const sourceSkillDir = path.join(repoRoot, '.github', 'skills', 'sengo');

if (!fs.existsSync(sourceSkillDir)) {
  fail(`Source skill not found at ${sourceSkillDir}`);
}

const targetProjectPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : process.cwd();

const targetSkillDir = path.join(
  targetProjectPath,
  '.github',
  'skills',
  'sengo'
);

try {
  fs.mkdirSync(path.dirname(targetSkillDir), { recursive: true });
  fs.rmSync(targetSkillDir, { recursive: true, force: true });
  fs.cpSync(sourceSkillDir, targetSkillDir, { recursive: true });

  info(`Installed skill to ${targetSkillDir}`);
  info('You can now invoke it with /sengo in the target project.');
} catch (err) {
  fail(`Install failed: ${err instanceof Error ? err.message : String(err)}`);
}
