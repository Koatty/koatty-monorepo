(() => {
  const $ = id => document.getElementById(id);
  let mode = 'git';
  let generation = 0;
  const tabs = [$('git-tab'), $('file-tab')];
  function select(next, preserveInput = false) {
    mode = next;
    generation++;
    tabs.forEach((tab, i) => { const chosen = (i === 0 ? 'git' : 'file') === mode; tab.setAttribute('aria-selected', String(chosen)); tab.tabIndex = chosen ? 0 : -1; });
    $('converter').setAttribute('aria-labelledby', mode + '-tab');
    $('source-label').textContent = mode === 'git' ? 'GitHub 仓库地址' : 'GitHub Release 页面或文件地址';
    $('source').placeholder = mode === 'git' ? 'https://github.com/owner/repository.git' : 'https://github.com/owner/repo/releases/download/tag/file.zip';
    $('input-help').textContent = mode === 'git' ? '支持 clone、fetch、pull 和 push。认证弹窗的密码栏填写 GitHub PAT（个人访问令牌），不是账号密码。' : '支持 Release 列表页、附件直链、源码归档、Raw 和 blob 文件链接。';
    if (!preserveInput) $('source').value = '';
    $('result').hidden = true; $('releases').hidden = true;
    $('form-message').textContent = '';
    $('submit').disabled = false;
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => select(i === 0 ? 'git' : 'file'));
    tab.addEventListener('keydown', event => { if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) { event.preventDefault(); const index = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - i; tabs[index].click(); tabs[index].focus(); } });
  });
  $('example').addEventListener('click', () => { $('source').value = mode === 'git' ? 'https://github.com/Koatty/koatty.git' : 'https://raw.githubusercontent.com/Koatty/koatty/master/README.md'; $('source').focus(); });
  $('source').addEventListener('input', () => { generation++; $('result').hidden = true; $('releases').hidden = true; $('form-message').textContent = ''; $('submit').disabled = false; });
  const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";
  function showLink(data) {
    const url = location.origin + data.path;
    $('output-url').textContent = url;
    $('output-command').textContent = data.kind === 'git' ? 'git clone ' + quote(url) : 'curl -fL --retry 3 -C - -o ' + quote(data.name || 'download') + ' ' + quote(url);
    $('result-type').textContent = data.kind === 'git' ? 'GIT / SMART HTTP' : 'FILE / STREAMING';
    $('download').hidden = data.kind === 'git';
    $('download').href = url;
    $('download').setAttribute('download', data.name || '');
    $('result').hidden = false;
    $('form-message').textContent = '';
  }
  function showReleases(data) {
    select('file', true);
    $('release-list').replaceChildren();
    $('release-note').textContent = data.releases.length ? '展示最近最多 ' + data.limit + ' 个公开版本。选择与你的系统对应的附件。' : '这个仓库暂时没有公开发布的版本。';
    $('release-source').href = data.source;
    for (const release of data.releases) {
      const section = document.createElement('section');
      const title = document.createElement('h3'); title.textContent = release.name + (release.prerelease ? ' · 预发布' : '');
      if (release.latest) { const badge = document.createElement('span'); badge.className = 'release-latest'; badge.textContent = 'Latest · 最新版'; title.append(badge); }
      const tag = document.createElement('p'); tag.className = 'release-tag'; tag.textContent = release.tag;
      section.append(title, tag);
      if (!release.assets.length) { const empty = document.createElement('p'); empty.textContent = '此版本没有可下载的附件。'; section.append(empty); }
      for (const asset of release.assets) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'release-asset';
        const name = document.createElement('span'); name.textContent = asset.name;
        const size = document.createElement('small'); size.textContent = (asset.size / 1024 / 1024).toFixed(1) + ' MB ↗';
        button.append(name, size);
        button.addEventListener('click', () => { showLink({...asset, kind:'file'}); $('result').scrollIntoView({behavior:'smooth', block:'nearest'}); });
        section.append(button);
      }
      $('release-list').append(section);
    }
    $('releases').hidden = false;
  }
  $('link-form').addEventListener('submit', async event => {
    event.preventDefault();
    const id = ++generation;
    $('submit').disabled = true;
    $('form-message').dataset.error = 'false';
    $('form-message').textContent = '正在校验链接…';
    $('result').hidden = true; $('releases').hidden = true;
    try {
      const response = await fetch('/api/links', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({url:$('source').value.trim()}), signal:AbortSignal.timeout(10000) });
      const data = await response.json();
      if (id !== generation) return;
      if (!response.ok) throw new Error(data.error?.message || data.message || '地址校验失败，请检查链接格式。');
      if (data.kind === 'releases') { showReleases(data); return; }
      if (!['git', 'file'].includes(data.kind)) throw new Error('服务返回了未识别的链接类型，请刷新页面后重试。');
      if (data.kind !== mode) throw new Error(mode === 'git' ? '请填写以 .git 结尾的仓库地址，或切换到文件下载。' : '这是 Git 仓库链接，请切换到 Git 版本控制。');
      showLink(data);
    } catch (error) {
      if (id !== generation) return;
      $('form-message').dataset.error = 'true';
      $('form-message').textContent = error.name === 'TimeoutError' ? '请求超时，请稍后重试。' : error.message === 'Failed to fetch' ? '网络连接失败，请检查网络后重试。' : error.message;
    } finally { if (id === generation) $('submit').disabled = false; }
  });
  for (const [button, source] of [['copy-url','output-url'],['copy-command','output-command']]) $(button).addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($(source).textContent); const old = $(button).textContent; $(button).textContent = '已复制 ✓'; setTimeout(() => { $(button).textContent = old; }, 1800); }
    catch { const range = document.createRange(); range.selectNodeContents($(source)); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); $('form-message').dataset.error = 'false'; $('form-message').textContent = '请按 Ctrl+C / ⌘C 复制已选中的内容。'; }
  });
  document.querySelectorAll('.prefix-example').forEach(element => { element.textContent = location.host + '/github.com/…'; });
  fetch('/healthz', {signal:AbortSignal.timeout(5000)}).then(response => { if(!response.ok) throw new Error(); return response.json(); }).then(data => { if(data.status !== 'ok') throw new Error(); $('health').dataset.ok = 'true'; $('health').textContent = '本站服务可用'; }).catch(() => { $('health').textContent = '服务暂不可用'; });
})();
