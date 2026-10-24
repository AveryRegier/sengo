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
const sourceShellSkillDir = path.join(repoRoot, '.github', 'skills', 'sengo-shell');

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

if (!fs.existsSync(sourceShellSkillDir)) {
  fail(`Source shell skill not found at ${sourceShellSkillDir}`);
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

const targetShellSkillDir = path.join(
  targetProjectPath,
  '.github',
  'skills',
  'sengo-shell'
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

  fs.mkdirSync(path.dirname(targetShellSkillDir), { recursive: true });
  fs.rmSync(targetShellSkillDir, { recursive: true, force: true });
  fs.cpSync(sourceShellSkillDir, targetShellSkillDir, { recursive: true });

  for (const subskill of discoveredSubskills) {
    const installedSkillPath = path.join(targetSkillDir, subskill.relPath, 'SKILL.md');
    if (!fs.existsSync(installedSkillPath)) {
      fail(`Subskill copy check failed for ${subskill.name} at ${installedSkillPath}`);
    }
  }

  const shellSkillPath = path.join(targetShellSkillDir, 'SKILL.md');
  if (!fs.existsSync(shellSkillPath)) {
    fail(`Shell skill copy check failed at ${shellSkillPath}`);
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

  info(`Installed shell skill to ${targetShellSkillDir}`);

  info('Usage in the target project:');
  info('  - /sengo for Sengo client code generation and safe query/index shapes');
  info('  - /sengo-shell for interactive shell research, analysis, and explain-mode queries');
  info('  - Ask /sengo to use the sengo-explain-optimizer workflow for explain-driven index tuning');
} catch (err) {
  fail(`Install failed: ${err instanceof Error ? err.message : String(err)}`);
}
