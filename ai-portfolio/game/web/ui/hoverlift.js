// 카드에 마우스를 올리면 들어 올리는 효과(손패 · 선택 창). CSS :hover로 하면 카드가 위로 움직이면서
// 마우스 밑에서 빠져나가 "올라감 ↔ 내려감"을 반복(떨림)한다. 그래서 JS로 hov 클래스를 붙인다.
// 규칙: ① 마우스가 올라간 카드의 지금 자리 안이면 그대로 둔다.
//       ② 아니면 "아무것도 올리지 않은 원래 배치"에서 그 지점의 맨 위 카드(같은 묶음 안에서 뒤쪽 순서)를 올린다.
// 판단이 올린 상태에 좌우되지 않으므로, 카드 사이 · 아래쪽 경계에서도 왔다 갔다 하지 않는다.
export function installHoverLift(selector, cls = 'hov') {
  let cur = null;
  let base = null;                       // cur를 올리기 전 자리
  const inside = (r, x, y) => r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  const drop = () => { cur?.classList.remove(cls); cur = null; base = null; };
  const update = (x, y) => {
    if (cur && !cur.isConnected) drop();
    if (cur && inside(cur.getBoundingClientRect(), x, y)) return;
    // 지금 마우스 아래 카드(없으면 올린 카드의 원래 자리인지)로 묶음을 정한다
    const top = document.elementFromPoint(x, y)?.closest(selector);
    const group = top ?? (cur && inside(base, x, y) ? cur : null);
    if (!group) { drop(); return; }
    let owner = null;
    for (const el of group.parentElement.children) {
      if (!el.matches(selector)) continue;
      const r = el === cur ? base : el.getBoundingClientRect();
      if (inside(r, x, y)) owner = el;   // 뒤쪽 순서가 위에 그려진다
    }
    if (owner === cur) return;
    drop();
    if (!owner) return;
    base = owner.getBoundingClientRect();
    cur = owner;
    owner.classList.add(cls);
  };
  document.addEventListener('pointermove', (e) => update(e.clientX, e.clientY), { passive: true });
  document.addEventListener('pointerleave', drop);
  window.addEventListener('blur', drop);
  return { drop };
}
