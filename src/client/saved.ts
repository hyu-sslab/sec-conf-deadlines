/**
 * 저장 목록 (내 마감).
 *
 * 목록은 브라우저에만 있다. 서버는 모든 카드를 그려 두고, 여기서 저장된 것만
 * 드러낸다 — 별도 엔드포인트를 만들지 않는 대신 화면 상태를 전부 이 모듈이 쥔다.
 */
import { SAVED_KEY, read, write } from './storage.ts';
import { flash } from './toast.ts';

function savedKeys(): string[] {
  return read<string[]>(SAVED_KEY, []);
}

export function isSaved(key: string): boolean {
  return savedKeys().includes(key);
}

const rowOf = (key: string) =>
  document.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);

/**
 * 축하 면의 그림을 붙인다.
 *
 * 내 마감 페이지는 마감이 있는 학회를 전부 그려 두고 저장한 것만 보여준다.
 * 그림을 마크업에 박아 두면 태그가 수십 개 생겨, 축하 면을 한 번도 보지 않는
 * 방문자도 브라우저가 받아 온다.
 */
export function armCat(row: HTMLElement): void {
  if (!row.hasAttribute('data-saved') || !row.hasAttribute('data-expired')) return;
  const cat = row.querySelector<HTMLImageElement>('img[data-cat]');
  if (cat && !cat.src) cat.src = cat.dataset.cat!;
}

/** 저장 상태를 화면 전체에 다시 칠한다. */
function paint(): void {
  const saved = savedKeys();

  for (const button of document.querySelectorAll<HTMLElement>('[data-save]')) {
    // 마감된 항목에는 '추가'가 없다. 이미 저장한 것의 '제거'는 남긴다.
    const expired = button.closest('[data-expired]') !== null;
    const on = saved.includes(button.dataset.save!);
    if (expired && !on && !button.hasAttribute('data-remove')) {
      button.hidden = true;
      continue;
    }
    button.hidden = false;
    button.toggleAttribute('data-on', on);
    button.setAttribute('aria-pressed', String(on));
    // 내 마감의 '제거' 버튼은 글자를 가진 버튼이라 아이콘으로 덮지 않는다.
    if (!button.hasAttribute('data-remove')) {
      button.textContent = on ? '★' : '＋';
    }
  }

  for (const badge of document.querySelectorAll<HTMLElement>('[data-saved-count]')) {
    badge.textContent = String(saved.length);
    badge.hidden = saved.length === 0;
  }

  // 내 마감 화면: 저장된 행만 드러낸다.
  const my = document.querySelector('[data-my]');
  if (!my) return;

  let shown = 0;
  for (const row of my.querySelectorAll<HTMLElement>('[data-key]')) {
    const on = saved.includes(row.dataset.key!);
    row.toggleAttribute('data-saved', on);
    if (on) {
      shown += 1;
      armCat(row);
    }
  }

  const setHidden = (selector: string, hidden: boolean) => {
    const el = my.querySelector<HTMLElement>(selector);
    if (el) el.hidden = hidden;
  };
  const count = my.querySelector<HTMLElement>('[data-saved-count-text]');
  if (count) count.textContent = String(shown);
  setHidden('[data-saved-head]', shown === 0);
  setHidden('[data-saved-hint]', shown === 0);
  setHidden('[data-empty]', shown > 0);
}

export function toggleSave(key: string): void {
  const saved = savedKeys();
  const on = saved.includes(key);
  write(SAVED_KEY, on ? saved.filter((k) => k !== key) : [...saved, key]);
  paint();
  const name = rowOf(key)?.querySelector('[data-title]')?.textContent?.trim() ?? '';
  flash(on ? `${name} 제거` : `${name} 추가`);
}

/**
 * 저장 버튼을 잇고 처음 한 번 칠한다.
 *
 * `data-expired`를 읽으므로 `startDeadlineRefresh()` 뒤에 불러야 한다.
 */
export function startSavedList(): void {
  document.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement)?.closest<HTMLElement>('[data-save]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    toggleSave(button.dataset.save!);
  });
  paint();
}
