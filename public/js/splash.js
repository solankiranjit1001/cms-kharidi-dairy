// v12.2: દર્શન — on the first opening of the app each day (any time), on every phone, show the
// mataji photo full screen for 3 seconds. Runs before the rest of the page is drawn.
(function () {
  var el = document.getElementById('splash');
  if (!el) return;
  var now = new Date();
  var today = now.getFullYear() + '-' + (now.getMonth() + 1) + '-' + now.getDate();
  var seen = null;
  try { seen = localStorage.getItem('cmsSplashDay'); } catch (e) { seen = null; }
  if (seen === today) { el.remove(); return; }
  try { localStorage.setItem('cmsSplashDay', today); } catch (e) { /* private mode: still show once */ }
  el.hidden = false;
  document.documentElement.style.overflow = 'hidden';
  setTimeout(function () {
    el.classList.add('hide');
    document.documentElement.style.overflow = '';
    setTimeout(function () { el.remove(); }, 600);
  }, 3000);
})();
