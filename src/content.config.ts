// @ts-check
import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// ---------------------------------------------------------------------------
// 五元组：每个数字必须带 数值 + 单位 + 时间 + 具名来源 + 抓取日期
// ---------------------------------------------------------------------------
const figureSchema = z.object({
  value: z.string(),          // 数值（保留原精度）
  unit: z.string(),           // 单位
  time: z.string(),           // 时间点/区间
  source: z.string(),         // 具名来源
  fetched: z.string(),        // 抓取日期 YYYY-MM-DD
});

// ---------------------------------------------------------------------------
// 内容 schema 硬约束（超长致构建失败）
// ---------------------------------------------------------------------------
const basePostSchema = z.object({
  title: z.string().max(120),          // title ≤120
  subtitle: z.string().max(160).optional(), // subtitle ≤160
  description: z.string().max(300),     // description ≤300
  pubDate: z.coerce.date(),             // 发布日期
  updatedDate: z.coerce.date().optional(), // 更正时必填
  reviewBy: z.coerce.date().optional(), // 核心事实预期变动日期（priced 文章 ≤180 天）
  figures: z.array(figureSchema).min(5),  // figures ≥5（五元组）
  sources: z.array(z.object({
    name: z.string(),                   // 具名来源
    url: z.string().url().optional(),   // 溯源链接
    type: z.enum(['primary', 'media', 'official']), // 信源类型
  })).min(3),                           // sources ≥3（一次文献）
  stakes: z.enum(['priced', 'directional']), // priced: 成本落发票 | directional: 只指方向
  target_keyword: z.string().optional(),     // 长尾关键词
  youtube_id: z.string().optional(),         // 视频回写（视频不进 git，只存 ID）
  revisions: z.array(z.object({
    date: z.coerce.date(),
    note: z.string().max(600),          // note ≤600 字符
  })).optional(),
  // 内链
  related: z.array(z.string()).optional(), // 相关文章 slug
});

// posts：单篇文章详情页
const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts',
    generateId: ({ entry }) => entry.replace(/\.md$/, '').split('/').pop() }),
  schema: basePostSchema,
});

// topics / countries / series：聚合页元数据（标题、描述、专题）
const hubSchema = z.object({
  title: z.string().max(120),
  description: z.string().max(300),
  slug: z.string(),               // 顶层 URL slug
  weight: z.number().optional(),  // 排序权重
  pin: z.boolean().optional(),    // 置顶
});
const topics = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/topics',
    generateId: ({ entry }) => entry.replace(/\.md$/, '').split('/').pop() }),
  schema: hubSchema,
});
const countries = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/countries',
    generateId: ({ entry }) => entry.replace(/\.md$/, '').split('/').pop() }),
  schema: hubSchema,
});
const series = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/series',
    generateId: ({ entry }) => entry.replace(/\.md$/, '').split('/').pop() }),
  schema: hubSchema,
});

// podcasts：AI 播客音频页
const podcasts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/podcasts',
    generateId: ({ entry }) => entry.replace(/\.md$/, '').split('/').pop() }),
  schema: z.object({
    title: z.string().max(120),
    description: z.string().max(300),
    pubDate: z.coerce.date(),
    audio_src: z.string().url().optional(), // 音频 URL（托管于 R2/播客托管商）
    episode: z.number().optional(),          // 集数
    youtube_id: z.string().optional(),
    related: z.array(z.string()).optional(), // 关联文章 slug
  }),
});

export const collections = { posts, topics, countries, series, podcasts };
