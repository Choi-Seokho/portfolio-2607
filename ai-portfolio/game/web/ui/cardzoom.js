// 작은 카드에 마우스를 올리면 정상 크기 카드를 옆에 띄우는 확대 보기(2026-10-13 사용자 피드백 —
// "드러난 보급품 · 미션 카드가 너무 작아서 안 보임. 호버하면 툴팁처럼 확대"). 오른쪽 위 드러난 보급품 · 왼쪽 미션 띠 공용.
// 화면 밖으로 나가지 않게: 기본은 카드 왼쪽(오른쪽 위 패널) 또는 오른쪽(왼쪽 미션 띠), 자리가 없으면 반대쪽.
import { renderCard } from './cards.js';

let big = null;

export function hideCardZoom() { big?.remove(); big = null; }

// el: 작은 카드 요소 · view: cardView/missionView 결과 · side: 'left' | 'right'(먼저 띄울 쪽)
export function attachCardZoom(el, view, { side = 'left', size = 'lg' } = {}) {   // lg: 읽기 편하게 정상보다 한 단계 크게
  el.classList.add('zoomable');
  el.addEventListener('mouseenter', () => {
    hideCardZoom();
    big = renderCard(view, { size });
    big.classList.add('card-zoom');
    document.body.append(big);
    const r = el.getBoundingClientRect();
    const w = big.offsetWidth, h = big.offsetHeight;
    const leftX = r.left - w - 12, rightX = r.right + 12;
    let x = side === 'left' ? (leftX >= 8 ? leftX : rightX) : (rightX + w <= innerWidth - 8 ? rightX : leftX);
    x = Math.min(Math.max(8, x), innerWidth - w - 8);
    const y = Math.min(Math.max(8, r.top + r.height / 2 - h / 2), innerHeight - h - 8);
    big.style.left = `${x}px`;
    big.style.top = `${y}px`;
  });
  el.addEventListener('mouseleave', hideCardZoom);
  return el;
}
