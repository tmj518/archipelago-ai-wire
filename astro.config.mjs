// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  // 静态站点：全部内容为静态 HTML，付费/权限/支付由 Cloudflare Workers 承担
  output: 'static',
  // site 需在域名确定后填写（用于 sitemap / canonical），当前留空，构建不受影响
  // site: 'https://YOUR-DOMAIN.example',
  compressHTML: true,
  build: {
    // 构建产物目录：Cloudflare Pages 部署源
    outDir: 'dist',
  },
});
