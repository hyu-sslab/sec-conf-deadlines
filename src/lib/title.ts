/**
 * 항목 이름 표기. 화면 네 곳과 ICS가 같은 규칙을 써야 한다.
 *
 * 사이클은 1차일 때 적지 않는다 — 라운드가 하나뿐인 학회가 대부분이라
 * "CCS 2027 1차"는 없는 구분을 있는 것처럼 보이게 한다.
 */
import type { Deadline } from './deadlines.ts';

export function editionTitle(
  item: Pick<Deadline, 'conference' | 'year' | 'cycle'>,
  cycleSuffix: (cycle: number) => string = (cycle) => ` ${cycle}차`,
): string {
  return `${item.conference.name} ${item.year}${item.cycle > 1 ? cycleSuffix(item.cycle) : ''}`;
}
