#!/usr/bin/env node
// serp-check.mjs — 信息增量闸门（SERP 快照验证）
// 用法: node tools/serp-check.mjs <file.md> --serp=file:data/serp/<文章名>.json
// 抓不到 SERP → INCONCLUSIVE，绝不 PASS（官方源不算竞品）
import { readFileSync, existsSync } from 'node:fs';
import matter from 'gray-matter';

function main() {
  const arg = process.argv[2];
  let serpPath = null;
  const serpArg = process.argv.find((a) => a.startsWith('--serp='));
  if (serpArg) serpPath = serpArg.replace('--serp=file:', '');

  if (!arg || arg === '--all') {
    console.log('SERP-INFO: 请指定单篇文件 + --serp 快照（serp-check 不跑全量）');
    return;
  }

  const raw = readFileSync(arg, 'utf8');
  const { data } = matter(raw);

  if (!serpPath || !existsSync(serpPath)) {
    console.error('SERP-INCONCLUSIVE: 未提供或未找到 SERP 快照，拒绝盖章');
    process.exit(2); // INCONCLUSIVE ≠ PASS
  }

  let serp;
  try { serp = JSON.parse(readFileSync(serpPath, 'utf8')); }
  catch { console.error('SERP-INCONCLUSIVE: SERP 快照 JSON 解析失败'); process.exit(2); }

  // 官方源不算竞品：SERP 里排除官方域名后，若已覆盖更完整则该题退回
  const official = /\.gov\b|\.mil\b|\.go\.|asean|imf|un\.org|miti|mida|matrade|bnm/i;
  const competitors = (serp.results || []).filter((r) => !official.test(r.url || ''));

  const targetKw = data.target_keyword || '';

  if (!competitors.length) {
    // 无非官方竞品 → 信息增量天然成立
    console.log(`SERP-PASS ${arg}（目标词 "${targetKw}"，无非官方竞品）`);
    return;
  }

  // 有竞品 → 需确认我方文章提供竞品没有的信息增量（人工标记增量点）
  if (!data.incremental_notes) {
    console.error(`SERP-INCONCLUSIVE: 存在 ${competitors.length} 个非官方竞品，但未标记信息增量点（frontmatter 缺 incremental_notes）`);
    process.exit(2);
  }
  console.log(`SERP-PASS ${arg}（${competitors.length} 个非官方竞品，已标记增量）`);
}

main();
