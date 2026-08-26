/**
 * 브라우저에서 도는 시간 표시.
 *
 * 사이트는 정적이라 서버가 그린 D-day는 빌드 시점 값이다. 배포가 며칠 지나면
 * 그만큼 밀리므로 여기서 다시 센다. 기준 시각은 마크업의 절대 시각
 * (`data-deadline` · `data-countdown`)이고, 계산은 서버와 같은 `dates.ts`를 쓴다.
 */
import { ddayLabel, urgencyTier } from '../lib/config.ts';
import { KST, MS, dDay, splitRemaining } from '../lib/dates.ts';

const pad = (value: number) => String(value).padStart(2, '0');

/** 같은 값을 다시 써도 배치가 다시 잡힌다. 매초 도는 루프라 걸러 준다. */
const put = (card: HTMLElement, key: string, value: string) => {
  const el = card.querySelector<HTMLElement>(`[data-${key}]`);
  if (el && el.textContent !== value) el.textContent = value;
};

/** 목록의 만료 여부와 D-day를 지금 기준으로 다시 쓴다. */
function refresh(): void {
  const now = new Date();
  for (const row of document.querySelectorAll<HTMLElement>('[data-deadline]')) {
    const instant = new Date(row.dataset.deadline!);
    const past = instant.getTime() <= now.getTime();
    row.toggleAttribute('data-expired', past);
    if (past || row.hasAttribute('data-estimated')) continue;

    const dday = dDay(instant, now, KST);
    row.dataset.dday = String(dday);
    const label = row.querySelector<HTMLElement>('.dday');
    if (label) {
      label.textContent = ddayLabel(dday);
      label.dataset.tier = String(urgencyTier(dday));
    }
  }
}

/**
 * 목록 D-day 갱신을 시작한다.
 *
 * `data-expired`를 읽는 코드보다 먼저 불러야 한다 — 저장 버튼 차단과
 * 상세 시트가 이 속성에 기댄다.
 */
export function startDeadlineRefresh(): void {
  refresh();
  // 탭을 열어 둔 채 자정을 넘기면 어제 숫자가 남는다.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });
}

/**
 * 내 마감의 카운트다운을 시작한다.
 *
 * `onExpire`는 마감으로 넘어간 카드마다 한 번만 불린다.
 */
export function startCountdown(onExpire: (card: HTMLElement) => void): void {
  const cards = [...document.querySelectorAll<HTMLElement>('[data-countdown]')];
  if (!cards.length) return;

  const tick = () => {
    const now = new Date();
    for (const card of cards) {
      const deadline = new Date(card.dataset.countdown!);
      const left = deadline.getTime() - now.getTime();
      const clock = card.querySelector<HTMLElement>('.clock');
      const closed = card.querySelector<HTMLElement>('[data-closed]');
      if (!clock || !closed) continue;

      /*
       * 넘긴 카드는 한 번만 뒤집는다. 매초 같은 값을 다시 쓰면 그때마다
       * 속성이 바뀐 것으로 잡혀 배치가 다시 서고, 축하 면이 도는 중이라
       * 그 흔들림이 눈에 띈다.
       */
      const wasExpired = card.hasAttribute('data-expired');
      if (left <= 0) {
        if (wasExpired) continue;
        clock.hidden = true;
        closed.hidden = false;
        // 카드 아래쪽(일정·캘린더)을 감추는 것은 CSS가 한다.
        card.setAttribute('data-expired', '');
        onExpire(card);
        continue;
      }
      if (wasExpired) {
        clock.hidden = false;
        closed.hidden = true;
        card.removeAttribute('data-expired');
      }

      const { days, hours, minutes, seconds } = splitRemaining(left);

      // 하루 안으로 들어오면 '일'을 뗀다. 서버 렌더와 같은 경계다.
      const dayUnit = card.querySelector<HTMLElement>('[data-unit-days]');
      if (dayUnit) dayUnit.hidden = left < MS.day;

      put(card, 'days', String(days));
      put(card, 'hours', pad(hours));
      put(card, 'minutes', pad(minutes));
      put(card, 'seconds', pad(seconds));

      clock.dataset.tier = String(urgencyTier(dDay(deadline, now, KST)));
    }
  };

  tick();
  setInterval(tick, MS.second);
}
