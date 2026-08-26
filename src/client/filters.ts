/** 목록 필터 (분야·등급·기간). 이 화면에만 있다. */
import { DEFAULT_HORIZON_MONTHS, monthBarHeight } from '../lib/config.ts';

export function startFilters(): void {
  startListFiltering();
  startFilterSheet();
}

/** 조건이 바뀔 때마다 목록 행을 걸러 낸다. */
function startListFiltering(): void {
  const list = document.querySelector('[data-list]');
  if (!list) return;

  const state = {
    // 기본은 렌더링된 전체 범위다. 아무것도 안 걸린 상태로 시작한다.
    range: DEFAULT_HORIZON_MONTHS,
    icore: new Set<string>(),
    grade: new Set<string>(),
    topic: new Set<string>(),
    q: '',
  };

  const params = new URLSearchParams(location.search);
  state.range = Number(params.get('m')) || DEFAULT_HORIZON_MONTHS;
  for (const kind of ['icore', 'grade', 'topic'] as const) {
    for (const value of (params.get(kind) ?? '').split(',').filter(Boolean)) {
      state[kind].add(value);
    }
  }
  state.q = params.get('q') ?? '';

  const monthsInRange = () => {
    const now = new Date();
    const keys = new Set<string>();
    for (let i = 0; i < state.range; i += 1) {
      const d = new Date(Date.UTC(now.getFullYear(), now.getMonth() + i, 1));
      keys.add(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    }
    return keys;
  };

  const apply = () => {
    const allowed = monthsInRange();
    const q = state.q.trim().toLowerCase();
    let visible = 0;

    for (const section of list.querySelectorAll<HTMLElement>('[data-section]')) {
      let count = 0;
      for (const row of section.querySelectorAll<HTMLElement>('[data-key]')) {
        const topics = (row.dataset.topics ?? '').split(' ');
        const ok =
          allowed.has(row.dataset.month ?? '') &&
          (state.icore.size === 0 || state.icore.has(row.dataset.icore ?? '')) &&
          (state.grade.size === 0 || state.grade.has(row.dataset.grade ?? '')) &&
          (state.topic.size === 0 || topics.some((t) => state.topic.has(t))) &&
          (q === '' || (row.dataset.name ?? '').includes(q));
        row.hidden = !ok;
        if (ok) count += 1;
      }
      section.hidden = count === 0;
      const label = section.querySelector('[data-section-count]');
      if (label) label.textContent = String(count);
      visible += count;
    }

    for (const el of document.querySelectorAll('[data-visible-count]')) {
      el.textContent = String(visible);
    }

    // 월 네비게이터도 필터 결과를 따라간다. 건수만 바뀌고 막대는
    // 남은 항목 기준으로 다시 정규화한다 — 절대값이 아니라 군집
    // 인지가 목적이므로 4단계면 충분하다 (요구사항 6.4).
    const cells = [...document.querySelectorAll<HTMLElement>('.cell[data-month]')];
    const counts = new Map<string, number>();
    for (const section of list.querySelectorAll<HTMLElement>('[data-section]')) {
      const key = section.dataset.section!;
      const n = [...section.querySelectorAll<HTMLElement>('[data-key]')].filter(
        (row) => !row.hidden,
      ).length;
      counts.set(key, n);
    }
    const peak = Math.max(1, ...[...counts.values()]);
    for (const cell of cells) {
      const key = cell.dataset.month!;
      const inRange = allowed.has(key);
      cell.hidden = !inRange;
      const n = counts.get(key) ?? 0;
      cell.toggleAttribute('data-empty', n === 0);
      const label = cell.querySelector<HTMLElement>('[data-count]');
      if (label) label.textContent = String(n);
      const bar = cell.querySelector<HTMLElement>('[data-bar]');
      if (bar) bar.style.height = `${monthBarHeight(n, peak)}px`;
    }

    const next = new URLSearchParams();
    if (state.range !== DEFAULT_HORIZON_MONTHS) next.set('m', String(state.range));
    for (const kind of ['icore', 'grade', 'topic'] as const) {
      if (state[kind].size) next.set(kind, [...state[kind]].join(','));
    }
    if (q) next.set('q', q);
    const qs = next.toString();
    history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
  };

  const syncChips = () => {
    for (const chip of document.querySelectorAll<HTMLElement>('[data-chip]')) {
      const kind = chip.dataset.kind as 'icore' | 'grade' | 'topic';
      chip.toggleAttribute('data-on', state[kind].has(chip.dataset.value!));
    }
    for (const chip of document.querySelectorAll<HTMLElement>('[data-range]')) {
      chip.toggleAttribute('data-on', Number(chip.dataset.range) === state.range);
    }
    for (const el of document.querySelectorAll('[data-range-label]')) {
      el.textContent = `${state.range}개월`;
    }

    // 선택된 필터만 바에 칩으로 올린다. 눌러서 바로 끌 수 있다.
    const tray = document.querySelector<HTMLElement>('[data-active-filters]');
    const badge = document.querySelector<HTMLElement>('[data-filter-count]');
    const active: Array<{ kind: 'icore' | 'grade' | 'topic'; value: string }> = [];
    for (const kind of ['icore', 'grade', 'topic'] as const) {
      for (const value of state[kind]) active.push({ kind, value });
    }

    if (badge) {
      badge.textContent = String(active.length);
      badge.hidden = active.length === 0;
    }

    if (tray) {
      tray.replaceChildren();
      for (const { kind, value } of active) {
        const source = document.querySelector<HTMLElement>(
          `#filter-sheet [data-chip][data-kind="${kind}"][data-value="${CSS.escape(value)}"]`,
        );
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.dataset.chip = '';
        chip.dataset.kind = kind;
        chip.dataset.value = value;
        chip.append(source?.dataset.short ?? value);
        const x = document.createElement('span');
        x.textContent = '×';
        x.setAttribute('aria-hidden', 'true');
        chip.append(x);
        chip.setAttribute('aria-label', `${source?.dataset.short ?? value} 필터 끄기`);
        tray.append(chip);
      }
    }
  };

  document.addEventListener('click', (event) => {
    const chip = (event.target as HTMLElement)?.closest<HTMLElement>('[data-chip]');
    if (chip) {
      const kind = chip.dataset.kind as 'icore' | 'grade' | 'topic';
      const value = chip.dataset.value!;
      state[kind].has(value) ? state[kind].delete(value) : state[kind].add(value);
      syncChips();
      apply();
      return;
    }
    const range = (event.target as HTMLElement)?.closest<HTMLElement>('[data-range]');
    if (range) {
      state.range = Number(range.dataset.range);
      syncChips();
      apply();
    }
  });

  document.getElementById('filter-search')?.addEventListener('input', (event) => {
    state.q = (event.target as HTMLInputElement).value;
    apply();
  });

  document.getElementById('filter-reset')?.addEventListener('click', () => {
    state.range = DEFAULT_HORIZON_MONTHS;
    state.icore.clear();
    state.grade.clear();
    state.topic.clear();
    state.q = '';
    const search = document.getElementById('filter-search') as HTMLInputElement | null;
    if (search) search.value = '';
    syncChips();
    apply();
  });

  const searchInput = document.getElementById('filter-search') as HTMLInputElement | null;
  if (searchInput) searchInput.value = state.q;
  syncChips();
  apply();
}

/** 필터 시트를 여닫고, 지난 마감 펼침을 잇는다. */
function startFilterSheet(): void {
  const filterSheet = document.getElementById('filter-sheet') as HTMLDialogElement | null;
  if (!filterSheet) return;

for (const opener of document.querySelectorAll('[data-open-filters]')) {
  opener.addEventListener('click', () => {
    filterSheet.showModal();
    filterSheet.focus();
  });
}
document.getElementById('filter-apply')?.addEventListener('click', () => filterSheet.close());
filterSheet.addEventListener('click', (event) => {
  if (event.target === filterSheet) filterSheet.close();
});

const pastToggle = document.getElementById('toggle-past');
pastToggle?.addEventListener('click', () => {
  const on = pastToggle.getAttribute('aria-pressed') === 'true';
  pastToggle.setAttribute('aria-pressed', String(!on));
  const past = document.querySelector<HTMLDetailsElement>('details.past');
  if (past) past.open = on; // 숨기기를 끄면 펼친다
});
}
