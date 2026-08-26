/**
 * 테마 전환.
 *
 * 테마는 세 상태다 — 명시 light · 명시 dark · 시스템. `data-theme`은 명시
 * 선택일 때만 붙으므로, 시스템 상태에서 무엇을 눌렀는지 알려면 미디어 질의를
 * 봐야 한다. 아이콘 교체는 CSS가 같은 세 상태로 처리한다.
 */
import { THEME_KEY, writeRaw } from './storage.ts';

export function startThemeToggle(): void {
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const root = document.documentElement;
    const prefersDark = matchMedia('(prefers-color-scheme: dark)').matches;
    const current = root.dataset.theme ?? (prefersDark ? 'dark' : 'light');
    root.dataset.theme = current === 'dark' ? 'light' : 'dark';
    writeRaw(THEME_KEY, root.dataset.theme);
  });
}
