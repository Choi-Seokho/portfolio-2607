/* dbdiagram.io "DBML-in-Link" 임베드 헬퍼 (재사용 가능)
   https://docs.dbdiagram.io/dbml-in-link-diagram/ 방식: DBML을 Base64 → URL 인코딩해서
   https://dbdiagram.io/embed#c=... 형태의 URL을 만듦. 계정/서버 저장 없이 그 자리에서 렌더링됨.
   URL fragment(#)는 서버로 전송되지 않아 DBML 내용이 dbdiagram.io 서버 로그에 남지 않음. */

function mountDbdiagramEmbed(dbml, iframeEl, linkEl) {
  const base64 = btoa(unescape(encodeURIComponent(dbml)));
  const url = 'https://dbdiagram.io/embed#c=' + encodeURIComponent(base64);
  if (iframeEl) iframeEl.src = url;
  if (linkEl) linkEl.href = url;
}
