/** 상단 월 스트립. 스크롤 위치를 따라 활성 월이 옮겨간다. */

export function startMonthNav(): void {
  const strip = document.querySelector<HTMLElement>('.nav');
  const monthCells = [...document.querySelectorAll<HTMLElement>('.cell[data-month]')];

  const markMonth = (key: string, follow: boolean) => {
    let active: HTMLElement | undefined;
    for (const cell of monthCells) {
      const on = cell.dataset.month === key;
      cell.toggleAttribute('data-active', on);
      if (on) {
        cell.setAttribute('aria-current', 'true');
        active = cell;
      } else {
        cell.removeAttribute('aria-current');
      }
    }
    // 활성 칸이 가로 스크롤 밖에 있으면 끌어온다.
    if (follow && active && strip) {
      const box = strip.getBoundingClientRect();
      const cell = active.getBoundingClientRect();
      if (cell.left < box.left + 8 || cell.right > box.right - 8) {
        strip.scrollTo({
          left: active.offsetLeft - box.width / 2 + cell.width / 2,
          behavior: 'smooth',
        });
      }
    }
  };

  for (const cell of monthCells) {
    if (!cell.hasAttribute('href')) continue;
    cell.addEventListener('click', () => markMonth(cell.dataset.month!, false));
  }

  /*
   * 스크롤을 따라 활성 월을 옮긴다.
   *
   * IntersectionObserver 대신 위치를 직접 잰다 — 월 헤더가 sticky라
   * 관찰자의 교차 판정이 실제로 보이는 달과 어긋난다. 스크롤러 상단을
   * 지난 마지막 섹션이 곧 지금 보고 있는 달이다.
   */
  const listScroller = document.querySelector<HTMLElement>('[data-list][data-scroll]');
  if (!listScroller || monthCells.length === 0) return;

  let queued = false;
  const sync = () => {
    queued = false;
    const top = listScroller.getBoundingClientRect().top + 4;
    let key = '';
    for (const section of listScroller.querySelectorAll<HTMLElement>('[data-section]')) {
      if (section.hidden) continue;
      if (section.getBoundingClientRect().top <= top) key = section.dataset.section!;
      else break;
    }
    if (key) markMonth(key, true);
  };
  listScroller.addEventListener(
    'scroll',
    () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(sync);
    },
    { passive: true },
  );
  sync();
}
