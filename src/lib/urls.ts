/**
 * 사이트 내부 링크.
 *
 * `import.meta.env.BASE_URL`은 astro.config의 `base` 설정을 그대로 반영하는데,
 * 끝 슬래시가 붙는지는 설정에 달려 있다. 각 호출부에서 문자열을 이어 붙이면
 * `/sec-conf-deadlinesyear` 같은 링크가 조용히 만들어진다.
 */
export function href(path = ''): string {
  const base = import.meta.env.BASE_URL.replace(/\/+$/, '');
  const rest = path.replace(/^\/+/, '');
  return rest ? `${base}/${rest}` : `${base}/`;
}
