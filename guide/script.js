// 手順のチェック状態はブラウザ(localStorage)に保存する
const STORAGE_KEY = 'claude-code-guide-progress';

function loadProgress() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch (e) { return {}; }
}
function saveProgress(p) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch (e) { /* 保存できなくても使える */ }
}

const progress = loadProgress();
const steps = [...document.querySelectorAll('.steps > li[data-step]')];

// 各手順に「できた」チェックを付ける
for (const li of steps) {
  const id = li.dataset.step;
  const label = document.createElement('label');
  label.className = 'check';
  label.innerHTML = '<input type="checkbox"> できた';
  const box = label.querySelector('input');
  box.checked = !!progress[id];
  li.classList.toggle('checked', box.checked);
  box.addEventListener('change', () => {
    progress[id] = box.checked;
    saveProgress(progress);
    li.classList.toggle('checked', box.checked);
    updateProgress();
  });
  li.appendChild(label);
}

function updateProgress() {
  const done = steps.filter(li => progress[li.dataset.step]).length;
  document.getElementById('progressText').textContent = `${done} / ${steps.length}`;
  document.getElementById('progressFill').style.width = `${(done / steps.length) * 100}%`;

  // 章の手順がすべて終わったら目次に ✓ を付ける
  for (const a of document.querySelectorAll('.toc a')) {
    const section = document.querySelector(a.getAttribute('href'));
    const items = [...section.querySelectorAll('.steps > li[data-step]')];
    const complete = items.length > 0 && items.every(li => progress[li.dataset.step]);
    let mark = a.querySelector('.done-mark');
    if (complete && !mark) {
      mark = document.createElement('span');
      mark.className = 'done-mark';
      mark.textContent = '✓';
      a.appendChild(mark);
    } else if (!complete && mark) {
      mark.remove();
    }
  }
}
updateProgress();

document.getElementById('resetProgress').addEventListener('click', () => {
  if (!confirm('すべてのチェックを外しますか?')) return;
  for (const key of Object.keys(progress)) delete progress[key];
  saveProgress(progress);
  for (const li of steps) {
    li.classList.remove('checked');
    li.querySelector('.check input').checked = false;
  }
  updateProgress();
});

// AIへの指示例にコピーボタンを付ける
const toast = document.getElementById('toast');
let toastTimer;
function showToast(text) {
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1500);
}

// クリップボードAPIが使えない環境では、一時的なテキスト欄を使う古い方法でコピーする
function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    ok ? resolve() : reject();
  });
}

for (const box of document.querySelectorAll('.prompt')) {
  const text = box.textContent.trim();
  const btn = document.createElement('button');
  btn.className = 'copy';
  btn.textContent = 'コピー';
  btn.addEventListener('click', () => {
    copyText(text)
      .then(() => showToast('コピーしました。Claude Code のチャット欄に貼り付けましょう'))
      .catch(() => showToast('コピーできませんでした。文字を選択してコピーしてください'));
  });
  box.appendChild(btn);
}

// スクリーンショット: data-src の画像があれば表示(クリックで別タブに拡大)、まだ無ければ準備中の枠を出す
for (const fig of document.querySelectorAll('figure.shot[data-src]')) {
  const src = fig.dataset.src;
  const img = new Image();
  img.alt = fig.querySelector('figcaption')?.textContent || '';
  img.onload = () => {
    const a = document.createElement('a');
    a.href = src;
    a.target = '_blank';
    a.rel = 'noopener';
    a.appendChild(img);
    fig.prepend(a);
  };
  img.onerror = () => {
    const ph = document.createElement('div');
    ph.className = 'shot-placeholder';
    ph.textContent = `スクリーンショット準備中(${src})`;
    fig.prepend(ph);
  };
  img.src = src;
}

// スクロール位置に合わせて目次の現在地を強調する
const tocLinks = [...document.querySelectorAll('.toc a')];
const observer = new IntersectionObserver(entries => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    tocLinks.forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + e.target.id));
  }
}, { rootMargin: '-40% 0px -55% 0px' });
document.querySelectorAll('main section').forEach(s => observer.observe(s));

// 狭い画面では ☰ で目次を開閉する
const sidebar = document.getElementById('sidebar');
document.getElementById('menuToggle').addEventListener('click', () => sidebar.classList.toggle('open'));
tocLinks.forEach(a => a.addEventListener('click', () => sidebar.classList.remove('open')));
