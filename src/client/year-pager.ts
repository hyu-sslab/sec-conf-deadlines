/** 연간 달력의 월 넘김. 이 화면에만 있다. */

export function startYearPager(): void {
  const pager = document.querySelector<HTMLElement>('[data-pager]');
  const monthSections = [...document.querySelectorAll<HTMLElement>('.month[data-month]')];

  if (!pager || monthSections.length === 0) return;

  const label = pager.querySelector<HTMLElement>('[data-pager-label]')!;
  const prev = pager.querySelector<HTMLButtonElement>('[data-prev]')!;
  const next = pager.querySelector<HTMLButtonElement>('[data-next]')!;
  const scroller = document.querySelector<HTMLElement>('[data-scroll]');

  // 오늘이 속한 달에서 시작한다. 없으면 그 다음으로 가까운 달.
  const todayKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
  })
    .format(new Date())
    .slice(0, 7);
  let index = monthSections.findIndex((s) => s.dataset.month! >= todayKey);
  if (index < 0) index = monthSections.length - 1;


  const show = (to: number, scroll = false) => {
    index = Math.max(0, Math.min(monthSections.length - 1, to));
    for (const [i, section] of monthSections.entries()) {
      section.toggleAttribute('data-current', i === index);
    }
    label.textContent = monthSections[index].dataset.label ?? '';
    prev.disabled = index === 0;
    next.disabled = index === monthSections.length - 1;
    if (scroll && scroller) scroller.scrollTop = 0;
  };

  prev.addEventListener('click', () => show(index - 1, true));
  next.addEventListener('click', () => show(index + 1, true));

  // 모바일에서는 넘기는 동작이 버튼보다 빠르다.
  let startX = 0;
  let startY = 0;
  scroller?.addEventListener(
    'touchstart',
    (event) => {
      startX = event.changedTouches[0].clientX;
      startY = event.changedTouches[0].clientY;
    },
    { passive: true },
  );
  scroller?.addEventListener(
    'touchend',
    (event) => {
      const dx = event.changedTouches[0].clientX - startX;
      const dy = event.changedTouches[0].clientY - startY;
      // 세로 스크롤과 겹치지 않도록 가로 이동이 확실할 때만 넘긴다.
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      show(index + (dx < 0 ? 1 : -1), true);
    },
    { passive: true },
  );

  pager.hidden = false;
  show(index);
}
