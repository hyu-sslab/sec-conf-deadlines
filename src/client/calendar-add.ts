/** 캘린더에 추가 팝업. 플랫폼마다 경로가 달라 버튼 문구도 달라진다. */

export function startCalendarAdd(): void {
  const calSheet = document.getElementById('cal-sheet') as HTMLDialogElement | null;
  if (!calSheet) return;

  /*
   * 애플에는 일정을 넣는 URL이 없어 .ics를 여는 것이 유일한 경로다.
   * 애플 기기에서는 캘린더가 열리지만 그 밖에서는 파일이 내려받아진다 —
   * 무슨 일이 일어나는지 버튼이 말하게 한다.
   */
  const onApple = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
  const appleLabel = calSheet.querySelector<HTMLElement>('[data-apple-label]');
  const appleLink = calSheet.querySelector<HTMLAnchorElement>('[data-pick-apple]');
  if (!onApple) {
    if (appleLabel) appleLabel.textContent = '일정 파일(.ics) 받기';
    appleLink?.setAttribute('download', '');
  }

  const pick = (name: string) =>
    calSheet.querySelector<HTMLAnchorElement>(`[data-pick-${name}]`);
  document.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement)?.closest<HTMLElement>('[data-add-cal]');
    if (!button) return;

    const google = pick('google');
    const apple = pick('apple');
    if (google) google.href = button.dataset.calGoogle!;
    // https로 준다. webcal://은 "구독"이라 일정 하나가 아니라 캘린더가 통째로 붙는다.
    if (apple) apple.href = button.dataset.calIcs!;

    calSheet.showModal();
    calSheet.focus();
  });

  calSheet.addEventListener('click', (event) => {
    if (event.target === calSheet) calSheet.close();
  });
  calSheet
    .querySelector('[data-close-cal]')
    ?.addEventListener('click', () => calSheet.close());
}
