(function () {
  var KEY = 'ce-mcp-theme';
  var THEMES = [
    ['grove', 'Grove'],
    ['harbor', 'Harbor'],
    ['ember', 'Ember'],
    ['night', 'Night'],
  ];

  function known(name) {
    for (var i = 0; i < THEMES.length; i++) if (THEMES[i][0] === name) return true;
    return false;
  }

  function read() {
    try {
      var saved = localStorage.getItem(KEY) || '';
      if (known(saved)) return saved;
    } catch (e) { /* private mode */ }
    return 'grove';
  }

  function apply(name) {
    if (!known(name)) name = 'grove';
    document.documentElement.setAttribute('data-theme', name);
    try { localStorage.setItem(KEY, name); } catch (e) { /* private mode */ }
    var pick = document.getElementById('theme');
    if (pick && pick.value !== name) pick.value = name;
  }

  apply(read());

  document.addEventListener('DOMContentLoaded', function () {
    var pick = document.getElementById('theme');
    if (!pick) {
      var nav = document.querySelector('nav');
      if (!nav) return;
      var label = document.createElement('label');
      label.className = 'theme-pick';
      label.appendChild(document.createTextNode('Theme'));
      pick = document.createElement('select');
      pick.id = 'theme';
      pick.setAttribute('aria-label', 'Color theme');
      for (var i = 0; i < THEMES.length; i++) {
        var opt = document.createElement('option');
        opt.value = THEMES[i][0];
        opt.textContent = THEMES[i][1];
        pick.appendChild(opt);
      }
      label.appendChild(pick);
      nav.appendChild(label);
    }
    pick.value = read();
    pick.addEventListener('change', function () { apply(pick.value); });
  });
})();
