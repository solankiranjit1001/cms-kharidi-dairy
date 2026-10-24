// Runs only on the old GitHub Pages address. Lets each phone download the data the old app kept in
// this browser, so it can be imported into the new server-backed app. Never deletes anything.
(function () {
  var keys = [['cmsKharidiDiaryV4', 'જૂની એપ V4'], ['cms_kharidi_dairy_records_v1', 'જૂની એપ V1/V2']];
  var found = 0, box = document.getElementById('buttons');
  keys.forEach(function (k) {
    var raw = null;
    try { raw = localStorage.getItem(k[0]); } catch (e) { raw = null; }
    if (!raw || raw === '[]') return;
    found++;
    var b = document.createElement('button');
    b.textContent = '⬇️ ' + k[1] + ' નો ડેટા ડાઉનલોડ કરો';
    b.onclick = function () {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
      a.download = 'cms-old-' + k[0] + '-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a); a.click(); a.remove();
    };
    box.appendChild(b); box.appendChild(document.createElement('br'));
  });
  document.getElementById('found').textContent = found ? 'આ ફોનમાં જૂનો ડેટા મળ્યો:' : 'આ ફોન/બ્રાઉઝરમાં જૂની એપનો ડેટા મળ્યો નથી.';
})();
