// ============================================================
// js/app.js  —  Application entry point
// ============================================================

// ── CONFIGURE YOUR API PROVIDER HERE ─────────────────────
//
// OPTION A: Google Gemini (free tier)
//   Get key at: https://aistudio.google.com
//var AI_PROVIDER = 'gemini';
//var AI_KEY      = 'YOUR_GEMINI_API_KEY_HERE';
var AI_PROVIDER = 'openrouter';
var AI_KEY      = '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';

// OPTION B: OpenRouter (free models available)
//   Get key at: https://openrouter.ai
//   Then set:
//     var AI_PROVIDER = 'openrouter';
//     var AI_KEY      = 'sk-or-v1-...';
//
// ─────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', function() {
  var modal = document.getElementById('api-modal');
  if (modal) modal.style.display = 'none';
  initSystem();
});

async function initSystem() {
  appendMsg('ai', '⏳ Building graph from real SAP O2C dataset...');
  buildGraph();
  initGraph();
  var messages = document.getElementById('messages');
  var last = messages.lastElementChild;
  if (last) last.remove();
  appendMsg('ai',
    '✅ Graph ready — <strong>' + document.getElementById('stat-nodes').textContent + ' nodes</strong>, ' +
    '<strong>' + document.getElementById('stat-edges').textContent + ' edges</strong> from ' +
    document.getElementById('stat-records').textContent + ' real records.<br><br>' +
    'Provider: <strong>' + AI_PROVIDER.toUpperCase() + '</strong> · Ask me anything about the O2C data!'
  );
}

window.addEventListener('resize', function() {
  if (typeof svg !== 'undefined' && svg) {
    var c = document.getElementById('graph-container');
    svg.attr('width', c.clientWidth).attr('height', c.clientHeight);
    if (simulation) simulation.force('center', d3.forceCenter(c.clientWidth/2, c.clientHeight/2)).alpha(0.3).restart();
  }
});
