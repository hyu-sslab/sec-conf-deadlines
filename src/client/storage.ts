/**
 * localStorage 접근.
 *
 * 사생활 보호 모드·저장 공간 부족·설정으로 차단된 브라우저에서는 읽기도 쓰기도
 * 던진다. 화면이 멈추는 것보다 저장이 안 되는 편이 낫다 — 조용히 기본값으로
 * 돌아간다.
 *
 * 저장 형식이 둘이다. 저장 목록은 배열이라 JSON이고, 테마는 생 문자열이다 —
 * `<head>`의 무플래시 스크립트가 모듈을 불러오기 전에 읽어야 해서 JSON.parse를
 * 쓸 수 없다. 형식을 바꾸면 이미 저장해 둔 사용자의 값이 안 맞게 된다.
 */
export const SAVED_KEY = 'nx-saved';

/** `Base.astro` `<head>`의 인라인 스크립트도 같은 키를 쓴다. */
export const THEME_KEY = 'nx-theme';

export function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

/** JSON으로 감싸지 않는다. 테마처럼 인라인 스크립트가 함께 읽는 값에 쓴다. */
export function writeRaw(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {}
}
