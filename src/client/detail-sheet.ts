/** 카드를 누르면 열리는 상세 시트. 목록 행의 data 속성만 읽어 채운다. */
import { RELAXED_TIER, ddayLabel, urgencyTier } from '../lib/config.ts';
import { isSaved, toggleSave } from './saved.ts';

export function startDetailSheet(): void {
  const detail = document.getElementById('detail-sheet') as HTMLDialogElement | null;
  if (!detail) return;

  const nameEl = document.getElementById('ds-name')!;
  const badgesEl = document.getElementById('ds-badges')!;
  const ddayEl = document.getElementById('ds-dday')!;
  const bodyEl = document.getElementById('ds-body')!;
  const saveEl = document.getElementById('ds-save')!;
  const cfpEl = document.getElementById('ds-cfp') as HTMLAnchorElement;
  const warnEl = document.getElementById('ds-warn')!;
  const hintEl = document.getElementById('ds-hint')!;
  let openKey = '';
  let openEstimated = false;

  const openDetail = (row: HTMLElement) => {
    openKey = row.dataset.key!;
    const card = row.querySelector('[data-card]')!;
    nameEl.textContent = card.querySelector('[data-title]')?.textContent ?? '';

    badgesEl.replaceChildren();
    const add = (cls: string, text: string) => {
      if (!text) return;
      const span = document.createElement('span');
      span.className = cls;
      span.textContent = text;
      badgesEl.append(span);
    };
    add('badge', row.dataset.icore ? `ICORE ${row.dataset.icore}` : '');
    add('badge', row.dataset.grade ? `교내 ${row.dataset.grade}` : '');

    // 추정 에디션은 확정된 마감과 같은 무게로 보여주지 않는다 (BR-004).
    openEstimated = row.hasAttribute('data-estimated');
    const dday = row.dataset.dday;
    ddayEl.textContent = openEstimated ? '예상' : ddayLabel(Number(dday));
    ddayEl.toggleAttribute('data-estimated', openEstimated);
    const n = Number(dday);
    ddayEl.dataset.tier = String(openEstimated ? RELAXED_TIER : urgencyTier(n));
    warnEl.hidden = !openEstimated;

    const tpl = card.querySelector<HTMLTemplateElement>('[data-detail]');
    bodyEl.replaceChildren(
      tpl ? tpl.content.cloneNode(true) : document.createTextNode(''),
    );

    cfpEl.href = row.dataset.source ?? '#';

    // 추정 에디션은 저장할 날짜가 없고, 지난 마감은 저장할 이유가 없다.
    const openExpired = row.hasAttribute('data-expired');
    const noSave = openEstimated || (openExpired && !isSaved(openKey));
    saveEl.hidden = noSave;
    hintEl.hidden = noSave;
    if (!noSave) {
      const saved = isSaved(openKey);
      saveEl.textContent = saved ? '내 마감에서 제거' : '내 마감에 추가';
      saveEl.toggleAttribute('data-on', saved);
      hintEl.textContent = '이 기기에 저장됩니다.';
    }
    detail.showModal();
    detail.focus();
  };

  saveEl.addEventListener('click', () => {
    toggleSave(openKey);
    const saved = isSaved(openKey);
    saveEl.textContent = saved ? '내 마감에서 제거' : '내 마감에 추가';
    saveEl.toggleAttribute('data-on', saved);
  });

  // 배경 클릭으로 닫기
  detail.addEventListener('click', (event) => {
    if (event.target === detail) detail.close();
  });

  for (const card of document.querySelectorAll<HTMLElement>('[data-card]')) {
    card.dataset.interactive = '';
    card.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('a, button')) return;
      openDetail(card.closest('[data-key]') as HTMLElement);
    });
  }
}
