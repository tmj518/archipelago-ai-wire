#!/usr/bin/env node
// reviewer-check.mjs — 摘要/正文/日期一致性闸门（替代人工审稿）
// 用法: node tools/reviewer-check.mjs <file.md> | node tools/reviewer-check.mjs --all
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import matter from 'gray-matter';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const CONTENT = join(__dir, '..', 'src', 'content', 'posts');

function fail(msgs) {
  console.error('REVIEWER-BLOCK:');
  msgs.forEach((m) => console.error('  - ' + m));
  process.exit(1);
}

function checkFile(file) {
  const raw = readFileSync(file, 'utf8');
  const { data, content } = matter(raw);
  const msgs = [];
  const name = file.split(/[\\/]/).pop();

  // 1) AI Summary 必须在 40–60 词
  const summaryMatch = content.match(/^([*\s]*\*\*?AI Summary\*\*?\s*[^\n]*)$/m);
  let summary = '';
  if (summaryMatch) summary = summaryMatch[1].replace(/[*#]/g, '').trim();
  const summaryWords = summary.split(/\s+/).length;
  if (summaryWords < 40 || summaryWords > 60) msgs.push(`AI Summary 词数 ${summaryWords} 不在 40–60`);

  // 2) 摘要必须与正文主题一致（摘要中出现的关键数字应在正文出现）
  const keyFigures = (summary.match(/\d[\d,.%]*/g) || []).slice(0, 3);
  keyFigures.forEach((f) => {
    const norm = f.replace(/,/g, '');
    if (!content.includes(norm)) msgs.push(`摘要数字 ${f} 未在正文出现（脱节）`);
  });

  // 3) 日期矛盾：pubDate 不得晚于 reviewBy（reviewBy 必须是未来）
  const pub = data.pubDate ? new Date(data.pubDate) : null;
  const review = data.reviewBy ? new Date(data.reviewBy) : null;
  if (pub && review && review < pub) msgs.push('reviewBy 早于 pubDate（日期矛盾）');
  // priced 文章 reviewBy 必须在 180 天内
  if (data.stakes === 'priced' && review) {
    const days = (review - pub) / (1000 * 60 * 60 * 24);
    if (days > 180) msgs.push(`priced 文章 reviewBy 距 pubDate ${days.toFixed(0)} 天 > 180`);
  }

  // 4) 无支撑论断：正文出现「必然/将/会」等强断言但无来源（弱启发）
  const strong = content.match(/(will (certainly|inevitably)|guaranteed|must (happen|occur))/gi);
  if (strong) msgs.push(`无支撑强断言: ${strong.slice(0, 3).join(' / ')}（需附来源或改为假设标注）`);

  // 5) 免责声明：趋势推演必须标「不构成投资建议」
  if (data.stakes && !/(does not constitute investment|not investment advice|不构成投资)/i.test(content)) {
    msgs.push('缺少免责声明（趋势推演须标「不构成投资建议」）');
  }

  return msgs;
}

function main() {
  const arg = process.argv[2];
  if (arg && arg !== '--all') {
    const msgs = checkFile(arg);
    if (msgs.length) fail(msgs);
    console.log(`REVIEWER-PASS ${arg}`);
    return;
  }
  const files = readdirSync(CONTENT).filter((f) => f.endsWith('.md'));
  if (!files.length) { console.log('REVIEWER-INFO: 无文章'); return; }
  let all = [];
  files.forEach((f) => all = all.concat(checkFile(join(CONTENT, f))));
  if (all.length) fail(all);
  console.log(`REVIEWER-PASS --all (${files.length} 篇)`);
}

main();
