// 가로로 넘기는 영역: 스크롤바 없이 휠(위아래 → 좌우)과 빈 곳 드래그로 이동, 양 끝에 더 있으면 흐리게(목업 v0.3에서 옮김).
// scale: 화면이 축소되어 있으면 그 배율(게임은 1).
export function hscroll(box, { scale = () => 1 } = {}) {
  box.classList.add('hs');
  // 휠은 목표 위치만 옮기고, 매 프레임 조금씩 따라가 부드럽게 움직인다(피드백 7 — 한 번에 툭 넘어가지 않게)
  let target = null;
  let raf = 0;
  const glide = () => {
    if (target == null) { raf = 0; return; }                 // 드래그가 시작되면 멈춤
    const d = target - box.scrollLeft;
    if (Math.abs(d) < 1) { box.scrollLeft = target; target = null; raf = 0; return; }
    box.scrollLeft += Math.sign(d) * Math.max(1, Math.abs(d) * 0.18);   // 스크롤 위치가 정수로 반올림돼도 멈추지 않게 최소 1px
    raf = requestAnimationFrame(glide);
  };
  box.addEventListener('wheel', (e) => {
    if (box.scrollWidth <= box.clientWidth) return;
    e.preventDefault();
    const max = box.scrollWidth - box.clientWidth;
    target = Math.max(0, Math.min(max, (target ?? box.scrollLeft) + (Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX)));
    if (!raf) raf = requestAnimationFrame(glide);
  }, { passive: false });
  let start = null;
  box.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('[draggable="true"], button')) return;
    target = null;
    start = { x: e.clientX, left: box.scrollLeft };
    box.setPointerCapture(e.pointerId);
  });
  box.addEventListener('pointermove', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    if (Math.abs(dx) > 4) box.classList.add('grabbing');
    box.scrollLeft = start.left - dx / scale();
  });
  const end = () => { start = null; box.classList.remove('grabbing'); };
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', end);
  box.addEventListener('scroll', () => edgeFade(box));
  requestAnimationFrame(() => edgeFade(box));
  return box;
}

export function edgeFade(box) {
  box.classList.toggle('more-l', box.scrollLeft > 2);
  box.classList.toggle('more-r', box.scrollLeft + box.clientWidth < box.scrollWidth - 2);
}
