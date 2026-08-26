/** 스크롤 중에는 탭바를 물린다 — 목록을 가리지 않게. */

export function startTabBarAutoHide(): void {
  const tabs = document.querySelector<HTMLElement>('.tabs');
  const scroller = document.querySelector<HTMLElement>('[data-scroll]');
  if (!tabs || !scroller) return;

  let idle: ReturnType<typeof setTimeout> | undefined;
  scroller.addEventListener(
    'scroll',
    () => {
      tabs.setAttribute('data-hidden', '');
      clearTimeout(idle);
      idle = setTimeout(() => tabs.removeAttribute('data-hidden'), 200);
    },
    { passive: true },
  );
}
