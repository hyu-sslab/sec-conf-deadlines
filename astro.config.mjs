// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  // GitHub Pages: https://<user>.github.io/<repo>
  // 커스텀 도메인을 붙이면 site만 교체하고 base는 '/'로 되돌린다.
  site: 'https://hyu-sslab.github.io',
  base: '/sec-conf-deadlines',
  trailingSlash: 'ignore',
  build: {
    // 정적 산출물만 생성한다. 런타임 데이터 fetch 없음.
    format: 'directory',
  },
});
