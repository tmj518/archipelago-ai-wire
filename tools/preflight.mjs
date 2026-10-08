#!/usr/bin/env node
// preflight.mjs — 总闸：串起所有闸门 + 关键文件检查
// 用法: node tools/preflight.mjs            # 静态闸门 + 文件完整性
//       node tools/preflight.mjs --build    # 额外跑 astro build
// 全绿 → ALL GREEN；任一失败 → FAIL（exit 1）
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, '..');
const withBuild = process.argv.includes('--build');

function run(cmd) {
  try {
    execSync(cmd, { stdio: 'inherit', cwd: root });
    return true;
  } catch {
    return false;
  }
}

const REQUIRED_FILES = [
  'package.json',
  'astro.config.mjs',
  'pnpm-workspace.yaml',
  'src/content.config.ts',
  'src/layouts/BaseLayout.astro',
  'src/pages/index.astro',
  'src/pages/articles/[slug].astro',
  'src/pages/podcast/[slug].astro',
  'tools/qa-check.mjs',
  'tools/serp-check.mjs',
  'tools/reviewer-check.mjs',
  'PROJECT_SPEC.md',
  'README.md',
  '进度日志.md',
];

let ok = true;
console.log('=== PREFLIGHT ===');

// 1) 关键文件
console.log('[1/4] 关键文件检查');
const missing = REQUIRED_FILES.filter((f) => !existsSync(join(root, f)));
if (missing.length) { console.error(`  ✗ 缺失: ${missing.join(', ')}`); ok = false; }
else console.log('  ✓ 全部存在');

// 2) qa 全量
console.log('[2/4] QA 闸门 (--all)');
if (!run('node tools/qa-check.mjs --all')) { ok = false; }

// 3) reviewer 全量
console.log('[3/4] Reviewer 闸门 (--all)');
if (!run('node tools/reviewer-check.mjs --all')) { ok = false; }

// 4) 构建
console.log('[4/4] 构建' + (withBuild ? ' (astro build)' : ' (跳过，用 --build 启用)'));
if (withBuild) {
  if (!run('pnpm build')) { ok = false; }
} else {
  console.log('  - 跳过（可用 --build 启用完整构建）');
}

if (ok) {
  console.log('\nPREFLIGHT: ALL GREEN ✅');
  process.exit(0);
} else {
  console.error('\nPREFLIGHT: FAIL ❌');
  process.exit(1);
}
