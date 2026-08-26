/** 세부분야. 페이지마다 반복하던 라벨 맵 만들기와 정렬을 한 곳에 둔다. */
import type { Deadline } from './deadlines.ts';

export interface TopicOption {
  id: string;
  label: string;
  short: string;
}

export interface Topics {
  /** 필터 칩용. `order` 순으로 정렬돼 있다. */
  options: TopicOption[];
  /** 카드에 붙는 `분야` 한 줄. */
  labelFor: (item: Deadline) => string;
}

export async function loadTopics(): Promise<Topics> {
  const { getCollection } = await import('astro:content');
  const entries = await getCollection('topics');
  const label = new Map(entries.map((entry) => [entry.id, entry.data.label]));
  return {
    options: entries
      .sort((a, b) => a.data.order - b.data.order)
      .map((entry) => ({ id: entry.id, label: entry.data.label, short: entry.data.short })),
    labelFor: (item) =>
      item.conference.topics.map((topic) => label.get(topic) ?? topic).join(' · '),
  };
}
