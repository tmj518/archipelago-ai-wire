import type { CollectionEntry } from "astro:content";

import { formatDate } from "../consts";

export type Post = CollectionEntry<"blog">;

/** Newest first, drafts removed. */
export function published(posts: Post[]): Post[] {
  return posts
    .filter((post) => !post.data.draft)
    .sort(
      (a, b) => b.data.publishDate.valueOf() - a.data.publishDate.valueOf(),
    );
}

/** The entry `id` doubles as the slug: /blog/<id>/ */
export function postHref(post: Post): string {
  return `/blog/${post.id}/`;
}

/** ~220 wpm, floor of 1 — shown in the hero and article meta lines. */
export function readingTime(body?: string): number {
  const words = body?.trim() ? body.trim().split(/\s+/).length : 0;
  return Math.max(1, Math.round(words / 220));
}

export interface CardData {
  href: string;
  date: string;
  title: string;
  excerpt: string;
}

export function toCard(post: Post): CardData {
  return {
    href: postHref(post),
    date: formatDate(post.data.publishDate),
    title: post.data.title,
    excerpt: post.data.description,
  };
}

/**
 * Related reading for the article footer: same silo first, then the newest
 * posts from anywhere so the slot is never half empty.
 */
export function relatedPosts(
  all: Post[],
  current: Post,
  limit = 3,
): CardData[] {
  const candidates = all.filter((post) => post.id !== current.id);
  const sameSilo = candidates.filter(
    (post) => post.data.category === current.data.category,
  );
  const others = candidates.filter(
    (post) => post.data.category !== current.data.category,
  );
  return [...sameSilo, ...others].slice(0, limit).map(toCard);
}

/** The lead story: explicit `featured: true`, else the newest post. */
export function leadStory(posts: Post[]): Post | undefined {
  return posts.find((post) => post.data.featured) ?? posts[0];
}

export interface NumberItem {
  label: string;
  value: string | number;
}

/**
 * "Today's Numbers" widget values, derived from the collection instead of
 * hard-coded, so the rail can never display invented statistics.
 */
export function numbersFor(posts: Post[]): NumberItem[] {
  const count = (priority: string) =>
    posts.filter((post) => post.data.priority === priority).length;

  return [
    { label: "Stories tracked", value: posts.length },
    { label: "P0 industry-level", value: count("P0") },
    { label: "P1 sector-level", value: count("P1") },
    { label: "Silos covered", value: new Set(posts.map((p) => p.data.category)).size },
  ];
}

