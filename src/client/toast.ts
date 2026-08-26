/** 짧은 알림. 같은 토스트를 다시 띄우면 애니메이션을 처음부터 돌린다. */
import { TOAST_MS } from '../lib/config.ts';

let timer: ReturnType<typeof setTimeout> | undefined;

export function flash(message: string): void {
  const el = document.getElementById('toast');
  const msg = document.getElementById('toast-msg');
  if (!el || !msg) return;

  clearTimeout(timer);
  msg.textContent = message;
  el.hidden = true;
  void el.offsetWidth; // 애니메이션 재시작
  el.hidden = false;
  timer = setTimeout(() => (el.hidden = true), TOAST_MS);
}
