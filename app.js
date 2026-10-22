/* Willow Park — a quiet interface for an alive landscape. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let audio = null, soundOn = false, soundBusy = false, toastTimer, rippleHint = false;
  let currentView = 'overview';
  const labels = { overview: ['晴湾湖畔', '01 / 03'], pavilion: ['听风小亭', '01 / 03'], dog: ['跟着「饼干」散步', '02 / 03'], garden: ['四季花园', '03 / 03'] };
  const toast = message => { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').classList.add('visible'); toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3600); };
  function selectView(view, immersive = true) {
    if (!window.ParkScene) return;
    currentView = view; window.ParkScene.setView(view);
    document.body.classList.toggle('immersed', immersive && view !== 'overview');
    document.querySelectorAll('.view-button').forEach(button => { const selected = button.dataset.view === view; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected)); });
    $('location-name').textContent = labels[view][0]; $('note-number').textContent = labels[view][1];
    $('discovery-panel').hidden = true; $('nav-discover').classList.remove('active'); $('nav-explore').classList.add('active');
    if (view === 'dog') toast('这是饼干。跟着它，去收集今天的快乐 🐾');
    if (view === 'pavilion') toast('风吹过小亭，湖水替你记住这一刻');
    if (view === 'garden') toast('花正在开。这里的长椅，永远有你的位置');
  }
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => selectView(button.dataset.view)));
  $('wander').addEventListener('click', () => selectView('pavilion'));
  $('brand-home').addEventListener('click', e => { e.preventDefault(); selectView('overview', false); });
  $('nav-explore').addEventListener('click', () => { selectView('overview', false); toast('拖动环视，滚轮缩放。轻点湖面，送给自己一圈涟漪。'); });
  $('nav-discover').addEventListener('click', () => { $('discovery-panel').hidden = !$('discovery-panel').hidden; $('nav-discover').classList.toggle('active', !$('discovery-panel').hidden); });
  $('close-discover').addEventListener('click', () => { $('discovery-panel').hidden = true; $('nav-discover').classList.remove('active'); });
  $('nav-about').addEventListener('click', () => $('about-dialog').showModal());
  $('close-about').addEventListener('click', () => $('about-dialog').close());
  $('about-dialog').addEventListener('click', e => { if (e.target === $('about-dialog')) { const r = e.target.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.target.close(); } });
  $('time-slider').addEventListener('input', e => {
    const v = Number(e.target.value) / 100;
    if (window.ParkScene) window.ParkScene.setTime(v);
    if (audio) audio.setTimeOfDay(v);
    $('time-label').textContent = v < .24 ? '清晨' : v < .65 ? '午后' : v < .85 ? '金暮' : '日落';
    let minutes;
    if (v <= .38) minutes = 390 + v / .38 * 480; else minutes = 870 + (v - .38) / .62 * 270;
    minutes = Math.round(minutes / 5) * 5;
    $('clock-label').textContent = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    $('weather-label').textContent = v < .24 ? '晴 · 20°' : v < .65 ? '晴 · 24°' : '晴 · 22°';
  });
  async function toggleSound() {
    if (soundBusy) return; soundBusy = true;
    try {
      if (!audio) { if (!window.ParkAudio) throw new Error('音频组件未能加载'); audio = new window.ParkAudio(); audio.setVolume(Number($('volume').value) / 100); }
      await audio.setEnabled(!soundOn); soundOn = audio.enabled;
      $('sound-toggle').setAttribute('aria-pressed', String(soundOn)); $('sound-toggle').setAttribute('aria-label', soundOn ? '关闭声音' : '开启声音'); $('sound-label').textContent = soundOn ? '声景已开启' : '声音关闭';
      if (soundOn) { $('sound-invitation').classList.add('dismissed'); toast('鸟鸣、流水与轻柔钢琴，已为你奏响 ♪'); }
      else toast('声音已暂停。安静也是一种风景。');
    } catch (e) { console.error('[Park audio]', e); toast('声音暂未开启，请再轻点一次声音按钮'); }
    finally { soundBusy = false; }
  }
  $('sound-toggle').addEventListener('click', toggleSound); $('enable-sound').addEventListener('click', toggleSound);
  $('sound-settings').addEventListener('click', () => { $('sound-popover').hidden = !$('sound-popover').hidden; $('sound-settings').setAttribute('aria-expanded', String(!$('sound-popover').hidden)); });
  document.querySelectorAll('.mix-choice').forEach(button => button.addEventListener('click', async () => {
    document.querySelectorAll('.mix-choice').forEach(b => b.classList.toggle('selected', b === button));
    if (!audio) audio = new window.ParkAudio();
    audio.setMix(button.dataset.mix);
    if (!soundOn) await toggleSound();
  }));
  $('volume').addEventListener('input', e => { $('volume-value').textContent = `${e.target.value}%`; if (audio) audio.setVolume(Number(e.target.value) / 100); });
  document.addEventListener('pointerdown', e => { if (!$('sound-popover').hidden && !$('sound-popover').contains(e.target) && !$('sound-settings').contains(e.target)) { $('sound-popover').hidden = true; $('sound-settings').setAttribute('aria-expanded', 'false'); } });
  $('fullscreen').addEventListener('click', async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); else toast('在浏览器菜单中可切换全屏欣赏'); } catch (_) { toast('可使用浏览器全屏功能欣赏风景'); } });
  document.addEventListener('fullscreenchange', () => $('fullscreen').setAttribute('aria-label', document.fullscreenElement ? '退出全屏' : '进入全屏'));
  window.addEventListener('park-ripple', () => { if (!rippleHint) { rippleHint = true; toast('你刚刚在湖里，种下了一圈温柔。'); } if (audio && audio.enabled && typeof audio.splash === 'function') audio.splash(); });
  window.addEventListener('park-message', e => toast(e.detail));
  window.addEventListener('park-ready', () => { $('experience').setAttribute('data-ready', 'true'); });
  window.ParkUI = { selectView, toast, getAudio: () => audio, get state() { return { view: currentView, soundOn, time: Number($('time-slider').value) }; } };
})();
