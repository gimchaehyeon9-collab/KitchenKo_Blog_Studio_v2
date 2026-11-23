(async () => {
  const el = document.getElementById('st');
  const ok = await chrome.permissions.contains({ permissions: ['debugger'] }).catch(() => false);
  el.textContent = ok ? '✓ 준비됨 (v' + chrome.runtime.getManifest().version + ')' : '입력 권한(debugger)이 없습니다. 확장을 다시 설치해 주세요.';
  el.className = 'st ' + (ok ? 'ok' : 'bad');
})();
