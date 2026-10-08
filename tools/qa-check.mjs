#!/usr/bin/env node
// qa-check.mjs — 结构/语言/数字规则闸门
// 用法: node tools/qa-check.mjs <file.md>  |  node tools/qa-check.mjs --all
// 失败即 BLOCK（exit 1）
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import matter from 'gray-matter';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const CONTENT = join(__dir, '..', 'src', 'content', 'posts');

// 禁止 AI 套话（大小写不敏感）
const BANNED_PHRASES = [
  'delve', 'landscape', 'in today\'s fast-paced world', "it's important to note",
  'when it comes to', 'in conclusion', 'furthermore, it is',
];
// 禁止模糊词（May 首字母大写不受限）
const BANNED_WORDS = [
  /\bmay\b/, /\bmight\b/, /\bpossibly\b/, /\bperhaps\b/, /\bcould\b/,
  /\breportedly\b/, /\ballegedly\b/,
];

function fail(msgs) {
  console.error('QA-BLOCK:');
  msgs.forEach((m) => console.error('  - ' + m));
  process.exit(1);
}

function checkFile(file) {
  const raw = readFileSync(file, 'utf8');
  const { data, content } = matter(raw);
  const msgs = [];
  const name = file.split(/[\\/]/).pop();

  // --- 长度上限（超长会致构建失败）---
  if (data.title && String(data.title).length > 120) msgs.push(`title ${data.title.length}>120`);
  if (data.subtitle && String(data.subtitle).length > 160) msgs.push(`subtitle ${data.subtitle.length}>160`);
  if (data.description && String(data.description).length > 300) msgs.push(`description ${data.description.length}>300`);

  // --- 五元组：figures ≥5，每条含五项 ---
  const REQUIRED = ['value', 'unit', 'time', 'source', 'fetched'];
  if (!Array.isArray(data.figures) || data.figures.length < 5) {
    msgs.push(`figures ${data.figures?.length || 0}<5`);
  } else {
    data.figures.forEach((f, i) => {
      REQUIRED.forEach((k) => { if (!f[k]) msgs.push(`figures[${i}] missing '${k}'`); });
    });
  }

  // --- sources ≥3 ---
  if (!Array.isArray(data.sources) || data.sources.length < 3) {
    msgs.push(`sources ${data.sources?.length || 0}<3`);
  } else {
    data.sources.forEach((s, i) => { if (!s.name) msgs.push(`sources[${i}] missing name`); });
  }

  // --- stakes 枚举 ---
  if (!['priced', 'directional'].includes(data.stakes)) msgs.push(`stakes invalid: ${data.stakes}`);

  // --- 待核实 → 不得发布 ---
  const pending = (content.match(/待核实/g) || []).length;
  if (pending > 0) msgs.push(`含「待核实」${pending} 处，不得发布`);
  if (pending > 2) msgs.push(`「待核实」超过 2 处，选题退回选题池`);

  // --- 英文门禁：禁词 ---
  const lower = content.toLowerCase();
  BANNED_PHRASES.forEach((p) => { if (lower.includes(p.toLowerCase())) msgs.push(`套话: "${p}"`); });
  BANNED_WORDS.forEach((re) => {
    const m = content.match(re);
    if (m) msgs.push(`模糊词: "${m[0]}"`);
  });

  // --- 正文结构（v2.0 新模板优先；旧 V6.1 兼容）---
  // v2.0 九段：ANSWER / What changed / Evidence chain / What would make this wrong / Limits / Impact by role / Action / FAQ
  const v20 = [
    /ANSWER/i, /What changed/i, /Evidence chain/i,
    /What would make this wrong/i, /Limits/i,
    /Impact by role/i, /Action/i, /## FAQ/i,
  ];
  const v61 = [
    '## What happened', '## Why now', '## So what', '## For you',
    '## The data point', '## How we calculated this', '## FAQ',
  ];
  const hasV20 = v20.every((re) => re.test(content));
  const hasV61 = v61.every((s) => content.includes(s));
  if (!hasV20 && !hasV61) {
    // 两套都缺，列出缺的
    v20.forEach((re, i) => { if (!re.test(content)) msgs.push(`v2.0 缺: ${re.source}`); });
    v61.forEach((s) => { if (!content.includes(s)) msgs.push(`v6.1 缺: ${s}`); });
  }
  // 对比表 + 定义块（v2.0 降为提示，不 BLOCK）
  // if (!content.includes('|') || !content.match(/\|[\s-]+\|/)) msgs.push('缺对比表');
  // if (!content.includes('**术语**')) msgs.push('缺定义块（> **术语** — 释义）');

  // --- v2.0 论文内核：可信度三类标注（硬规则）---
  const hasFact = /Confirmed fact|已确认事实/i.test(content);
  const hasInference = /Reasonable inference|合理推断/i.test(content);
  const hasView = /Our view|My view|我们的观点|我的观点/i.test(content);
  if (!hasFact) msgs.push('缺【已确认事实 / Confirmed fact】标注');
  if (!hasInference) msgs.push('缺【合理推断 / Reasonable inference】标注');
  if (!hasView) msgs.push('缺【我的观点 / Our view】标注');

  // --- v2.0 论文内核：反面论证段（硬规则，护城河）---
  if (!/What would make this wrong|counterargument|反面/i.test(content)) {
    msgs.push('缺【反面论证 / What would make this wrong】段（护城河，免费来源不写）');
  }
  // --- v2.0 论文内核：局限段（硬规则）---
  if (!/(##\s*)?Limits|What we do not yet know|局限/i.test(content)) {
    msgs.push('缺【局限 / Limits】段（论文 limitation）');
  }

  // 词数 1500–2500
  const words = content.replace(/[#*>`_|]/g, ' ').trim().split(/\s+/).length;
  if (words < 1500 || words > 2500) msgs.push(`正文字数 ${words} 不在 1500–2500`);

  // --- 第一人称体验 / 编造金额检查（弱启发）---
  if (/\bI (saw|felt|went|bought|paid)\b/i.test(content)) msgs.push('疑似第一人称体验');
  if (/USD\s+\d{2,}\s*[kK]?/.test(content) && !data.figures?.length) msgs.push('疑似未标注来源的金额');

  return msgs;
}

function main() {
  const arg = process.argv[2];
  if (arg && arg !== '--all') {
    const msgs = checkFile(arg);
    if (msgs.length) fail(msgs);
    console.log(`QA-PASS ${arg}`);
    return;
  }
  // --all
  const files = readdirSync(CONTENT).filter((f) => f.endsWith('.md'));
  if (!files.length) { console.log('QA-INFO: 无文章'); return; }
  let all = [];
  files.forEach((f) => all = all.concat(checkFile(join(CONTENT, f))));
  if (all.length) fail(all);
  console.log(`QA-PASS --all (${files.length} 篇)`);
}

main();
