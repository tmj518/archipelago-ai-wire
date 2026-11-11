const frontmatterOf = (markdown) => /^---\r?\n([\s\S]*?)\r?\n---/m.exec(String(markdown ?? ""))?.[1] ?? "";

export function hasHumanReviewField(markdown) {
  return /^human_review\s*:/m.test(frontmatterOf(markdown));
}

export function humanReviewBlockIsComplete(frontmatter) {
  const lines = String(frontmatter ?? "").split(/\r?\n/);
  const start = lines.findIndex((line) => /^human_review\s*:\s*$/.test(line));
  if (start < 0) return false;
  const block = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) break;
    block.push(line.trim());
  }
  const reviewer = block.find((line) => /^reviewer\s*:/i.test(line))?.replace(/^reviewer\s*:\s*/i, "").replace(/^(["'])(.*)\1$/, "$2").trim();
  const date = block.find((line) => /^date\s*:/i.test(line))?.replace(/^date\s*:\s*/i, "").replace(/^(["'])(.*)\1$/, "$2").trim();
  if (!reviewer || reviewer.length < 2 || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}
