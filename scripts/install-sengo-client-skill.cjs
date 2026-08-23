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

function getSkillDirs(rootDir) {
  const dirs = [];

  function walk(currentDir) {
    const skillFile = path.join(currentDir, 'SKILL.md');
    if (fs.existsSync(skillFile)) {
      dirs.push(currentDir);
    }

    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      walk(path.join(currentDir, entry.name));
    }
  }

  walk(rootDir);
  return dirs;
}

function readSkillName(skillDir) {
  const skillFile = path.join(skillDir, 'SKILL.md');
  const content = fs.readFileSync(skillFile, 'utf8');
  const match = content.match(/^name:\s*['\"]?([^'\"\r\n]+)['\"]?\s*$/m);
  return match ? match[1].trim() : path.basename(skillDir);
}

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

const discoveredSkillDirs = getSkillDirs(sourceSkillDir);
const discoveredSubskills = discoveredSkillDirs
  .filter(skillDir => skillDir !== sourceSkillDir)
  .map(skillDir => {
    const relPath = path.relative(sourceSkillDir, skillDir);
    return {
      name: readSkillName(skillDir),
      relPath,
    };
  });

try {
  fs.mkdirSync(path.dirname(targetSkillDir), { recursive: true });
  fs.rmSync(targetSkillDir, { recursive: true, force: true });
  fs.cpSync(sourceSkillDir, targetSkillDir, { recursive: true });

  for (const subskill of discoveredSubskills) {
    const installedSkillPath = path.join(targetSkillDir, subskill.relPath, 'SKILL.md');
    if (!fs.existsSync(installedSkillPath)) {
      fail(`Subskill copy check failed for ${subskill.name} at ${installedSkillPath}`);
    }
  }

  info(`Installed skill to ${targetSkillDir}`);
  if (discoveredSubskills.length === 0) {
    info('Installed 0 bundled subskills.');
  } else {
    info(`Installed ${discoveredSubskills.length} bundled subskill(s):`);
    for (const subskill of discoveredSubskills) {
      info(`  - ${subskill.name} (${subskill.relPath})`);
    }
  }

  info('Usage in the target project:');
  info('  - /sengo for Sengo client code generation and safe query/index shapes');
  info('  - Ask /sengo to use the sengo-explain-optimizer workflow for explain-driven index tuning');
} catch (err) {
  fail(`Install failed: ${err instanceof Error ? err.message : String(err)}`);
}
