"use strict";

// ═══════════════════════════════════════════════════════
// claude-island spring params → CSS cubic-bezier:
//   expand : 0.42s cubic-bezier(0.34, 1.25, 0.64, 1)   ← spring(0.42, 0.8)
//   collapse: 0.45s cubic-bezier(0.25, 0.46, 0.45, 0.94) ← spring(0.45, 1.0) no overshoot
//   content : 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94) ← .smooth
//   fast-out: 0.15s cubic-bezier(0.25, 0.46, 0.45, 0.94)
// ═══════════════════════════════════════════════════════

// ── Spinner (claude-island ProcessingSpinner: ·✢✳∗✻✽ @ 150ms) ──
const SPIN = ["·", "✢", "✳", "∗", "✻", "✽"];
let _spinIdx = 0, _spinTimer = null;

function startSpinner() {
  if (_spinTimer) return;
  _spinTimer = setInterval(() => {
    _spinIdx = (_spinIdx + 1) % SPIN.length;
    const f = SPIN[_spinIdx];
    for (const el of document.querySelectorAll(".spin")) el.textContent = f;
  }, 150);
}
function stopSpinner() {
  if (_spinTimer) { clearInterval(_spinTimer); _spinTimer = null; }
}

// ── State ──
let sessions = [];
let prevIds = null;     // Set of sessionIds from last render (null = first time)
let idsChanged = false; // flag so we only animate new rows on fresh updates

// ── Mode machine ──
let currentMode = "orb";
document.body.dataset.mode = "orb";

// ── Orb size (outer window dimension, updated by applyPrefs) ──
let _orbOuter = 46;

// ── Drag state ──
let dragging = false, dragX = 0, dragY = 0;

// ═══════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════
function fmt(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 5)  return "just now";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, "0")}m`;
}
function shorten(p) {
  if (!p) return "";
  const u = p.match(/^(\/Users\/[^/]+|\/home\/[^/]+)/);
  if (u) return "~" + p.slice(u[0].length);
  const w = p.match(/^[A-Za-z]:\\Users\\[^\\]+/);
  if (w) return "~" + p.slice(w[0].length).replace(/\\/g, "/");
  return p;
}
function esc(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
const PRIO = { error:8, notification:7, sweeping:6, attention:5, carrying:4, juggling:4, working:3, thinking:2, idle:1, sleeping:0 };

// ═══════════════════════════════════════════════════════
// Size reporting
// ═══════════════════════════════════════════════════════
function reportCardPositions() {
  const pos = {};
  for (const row of document.querySelectorAll(".srow")) {
    const r = row.getBoundingClientRect();
    pos[row.dataset.sid] = { top: Math.round(r.top), bottom: Math.round(r.bottom), centerY: Math.round((r.top+r.bottom)/2) };
  }
  window.electronAPI.reportCardPositions(pos);
}

function panelHeight() {
  const bar  = document.getElementById("cap-bar");
  const list = document.getElementById("slist");
  const dnd  = document.getElementById("dnd-bar");
  if (!bar) return 40;
  return bar.offsetHeight
    + (list ? list.scrollHeight : 0)
    + (dnd && dnd.classList.contains("on") ? dnd.offsetHeight : 0)
    + 2; // border
}

// ═══════════════════════════════════════════════════════
// Mode transitions (claude-island spring animations)
// ═══════════════════════════════════════════════════════
const MODE_TIMINGS = {
  expand: 320,
  collapse: 280,
};

let _modeTransitionTimer = null;
let _modeTransitionToken = 0;

document.body.dataset.phase = "idle";
document.body.dataset.content = "hidden";

function _clearModeTransitionTimer() {
  if (_modeTransitionTimer) {
    clearTimeout(_modeTransitionTimer);
    _modeTransitionTimer = null;
  }
}

function _isTransitioning() {
  return document.body.dataset.phase !== "idle";
}

function _syncPanelHeight() {
  if (currentMode !== "panel" || _isTransitioning()) return;
  requestAnimationFrame(() => {
    if (currentMode !== "panel" || _isTransitioning()) return;
    window.electronAPI.reportListHeight(panelHeight());
  });
}

function setMode(mode) {
  if (currentMode === mode) return;
  currentMode = mode;

  const orbEl  = document.getElementById("orb");
  const token = ++_modeTransitionToken;
  _clearModeTransitionTimer();
  if (orbEl) orbEl.classList.remove("pop-in", "exit-out");

  if (mode === "orb") {
    // panel → orb: hide content immediately, then shrink the window/shell together.
    stopSpinner();
    document.body.dataset.mode = "panel";
    document.body.dataset.phase = "collapsing";
    document.body.dataset.content = "hidden";
    window.electronAPI.reportWindowSize(_orbOuter, _orbOuter);

    _modeTransitionTimer = setTimeout(() => {
      if (token !== _modeTransitionToken) return;
      document.body.dataset.mode = "orb";
      document.body.dataset.phase = "idle";
      document.body.dataset.content = "hidden";
      _modeTransitionTimer = null;
      if (orbEl) {
        void orbEl.offsetWidth;
        orbEl.classList.add("pop-in");
        orbEl.addEventListener("animationend", () => orbEl.classList.remove("pop-in"), { once: true });
      }
      updateOrb();
    }, MODE_TIMINGS.collapse);

  } else { // panel
    // orb → panel: orb exits while the shell/window expands from the orb center.
    document.body.dataset.mode = "panel";
    document.body.dataset.phase = "expanding";
    document.body.dataset.content = "hidden";
    startSpinner();
    renderRows();
    updateCapsule();
    updateOrb();
    if (orbEl) orbEl.classList.add("exit-out");

    requestAnimationFrame(() => {
      if (token !== _modeTransitionToken) return;
      document.body.dataset.content = "visible";
      window.electronAPI.reportWindowSize(340, panelHeight());
    });

    _modeTransitionTimer = setTimeout(() => {
      if (token !== _modeTransitionToken) return;
      document.body.dataset.phase = "idle";
      document.body.dataset.content = "visible";
      _modeTransitionTimer = null;
      if (orbEl) orbEl.classList.remove("exit-out");
      reportCardPositions();
      _syncPanelHeight();
    }, MODE_TIMINGS.expand);
  }
}

// ═══════════════════════════════════════════════════════
// ORB dots update
// ═══════════════════════════════════════════════════════
let _lastOrbStateClass = "";

function updateOrb() {
  const orb      = document.getElementById("orb");
  const statusEl = document.getElementById("orb-status");
  const nameEl   = document.getElementById("orb-name");
  const dots     = document.getElementById("orb-dots");
  if (!orb || !dots) return;

  const vis = sessions.filter(s => !s.headless);
  const sorted = [...vis].sort((a,b) => (PRIO[b.state]||0) - (PRIO[a.state]||0));
  const top = sorted[0];

  const hasErr  = vis.some(s => s.state === "error");
  const hasPerm = vis.some(s => s.state === "notification");
  const hasAct  = vis.some(s => ["working","thinking","juggling"].includes(s.state));

  // Breathing animation class
  const stateClass = hasErr ? " s-err" : hasPerm ? " s-perm" : hasAct ? " s-active" : "";
  if (stateClass !== _lastOrbStateClass) {
    _lastOrbStateClass = stateClass;
    // Pulse when state changes (skip initial)
    if (_lastOrbStateClass !== "" || stateClass !== "") {
      orb.classList.add("state-pulse");
      orb.addEventListener("animationend", () => orb.classList.remove("state-pulse"), { once: true });
    }
  }
  // Preserve pop-in/exit-out/state-pulse classes
  const keep = ["pop-in","exit-out","state-pulse"].filter(c => orb.classList.contains(c));
  orb.className = "orb" + stateClass;
  for (const c of keep) orb.classList.add(c);

  // Status symbol (top of orb)
  if (statusEl) {
    if (top) {
      const isActive = ["working","thinking","juggling"].includes(top.state);
      const isPerm   = top.state === "notification";
      const isErr    = top.state === "error";
      const isDone   = top.state === "attention";
      if (isActive) {
        statusEl.innerHTML = `<span class="spin" style="color:var(--orange);font-size:13px">${SPIN[_spinIdx]}</span>`;
        statusEl.style.cssText = "";
      } else {
        const bg = isPerm ? "var(--amber)" : isErr ? "var(--red)" : isDone ? "var(--green)" : "rgba(255,255,255,0.28)";
        statusEl.innerHTML = `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${bg}"></span>`;
        statusEl.style.cssText = "";
      }
    } else {
      statusEl.innerHTML = `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,0.15)"></span>`;
      statusEl.style.cssText = "";
    }
  }

  // State label
  if (nameEl) {
    const STATE_LABEL = { notification: "perm", attention: "done", juggling: "busy" };
    nameEl.textContent = top ? (STATE_LABEL[top.state] || top.state || "idle") : "idle";
  }

  // Session dots (max 5)
  dots.innerHTML = vis.slice(0, 5).map(s => {
    const c = s.state === "error" ? " err" : s.state === "notification" ? " perm"
      : ["working","thinking","juggling"].includes(s.state) ? " active" : "";
    return `<span class="orb-dot${c}"></span>`;
  }).join("") + (vis.length > 5 ? `<span style="font-size:8px;color:#555">+${vis.length - 5}</span>` : "");

  // Spinner management when in orb mode
  if (currentMode === "orb") {
    if (hasAct) startSpinner(); else stopSpinner();
  }
}

// ═══════════════════════════════════════════════════════
// Capsule bar update (PANEL top indicator — "VigilCLI" + session dots)
// ═══════════════════════════════════════════════════════
function updateCapsule() {
  const indEl   = document.getElementById("cap-ind");
  const agentEl = document.getElementById("cap-agent");
  const lineEl  = document.getElementById("cap-line");
  const toolEl  = document.getElementById("cap-tool");
  const statEl  = document.getElementById("cap-status");
  if (!indEl) return;

  const vis = sessions.filter(s => !s.headless);

  // Minimal header: "VigilCLI" + colored session dots on the right
  indEl.innerHTML = "";
  agentEl.style.cssText = "color:var(--t25)";
  agentEl.textContent = "VigilCLI";
  lineEl.className = "";
  statEl.textContent = "";
  statEl.removeAttribute("style");

  const dotColor = s => {
    if (["working","thinking","juggling"].includes(s.state)) return "var(--orange)";
    if (s.state === "notification") return "var(--amber)";
    if (s.state === "error")        return "var(--red)";
    if (s.state === "attention")    return "var(--green)";
    return "rgba(255,255,255,0.18)";
  };
  const shown = vis.slice(0, 8);
  const extra = vis.length > 8 ? `<span style="font-size:9px;color:var(--t25);margin-left:1px">+${vis.length - 8}</span>` : "";
  toolEl.style.cssText = "display:flex;align-items:center;gap:5px;max-width:none;font-family:inherit";
  toolEl.innerHTML = shown.map(s =>
    `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${dotColor(s)};flex-shrink:0"></span>`
  ).join("") + extra;
}

// ═══════════════════════════════════════════════════════
// Session rows (claude-island InstanceRow)
// ═══════════════════════════════════════════════════════
function buildRow(s) {
  const active = ["working","thinking","juggling"].includes(s.state);
  const perm   = s.state === "notification";
  const err    = s.state === "error";
  const done   = s.state === "attention";
  const ms     = Date.now() - s.updatedAt;
  const min    = ms / 60000;
  const tCls   = min > 15 ? "tr" : min > 5 ? "ta" : "";

  // State indicator
  let ind;
  if (active) {
    ind = `<span class="spin" style="color:var(--orange)">${SPIN[_spinIdx]}</span>`;
  } else if (perm) {
    ind = `<span class="ind-dot a"></span>`;
  } else if (err) {
    ind = `<span class="ind-dot r"></span>`;
  } else if (done) {
    ind = `<span class="ind-dot g"></span>`;
  } else {
    ind = `<span class="ind-dot"></span>`;
  }

  // Subtitle: tool call or cwd
  let sub = "";
  if (active && s.currentTool) {
    sub = `<span class="stool">${esc(s.currentTool)}</span>`;
    if (s.currentToolInput) {
      const inp = s.currentToolInput;
      const hint = typeof inp === "object"
        ? (inp.command || inp.file_path || inp.query || inp.pattern || "")
        : String(inp);
      if (hint) sub += ` <span style="color:var(--t40)">${esc(String(hint).slice(0, 52))}</span>`;
    }
  } else if (s.cwd) {
    sub = `<span style="color:var(--t40)">${esc(shorten(s.cwd))}</span>`;
  }

  // Subagent row (separate line, like old card-subagents)
  const subagentRow = s.subagentCount > 0
    ? `<div class="ssub" style="color:var(--orange);opacity:.75">└─ ⚡ subagent${s.subagentCount > 1 ? ` ×${s.subagentCount}` : ""}</div>`
    : "";

  // Status pill (same as cap-bar shows for top session)
  let pill = "";
  if (perm) {
    pill = `<span class="spill" style="color:var(--amber);background:rgba(255,178,0,.1)">permission</span>`;
  } else if (err) {
    pill = `<span class="spill" style="color:var(--red);background:rgba(255,77,77,.1)">error</span>`;
  } else if (active) {
    pill = `<span class="spill" style="color:var(--orange);background:rgba(217,120,87,.1)">${s.state}</span>`;
  } else if (done) {
    pill = `<span class="spill" style="color:var(--green);background:rgba(102,191,115,.1)">done</span>`;
  } else {
    pill = `<span class="spill" style="color:var(--t25);background:rgba(255,255,255,.05)">${s.state}</span>`;
  }

  return `<div class="srow" data-sid="${esc(s.sessionId)}">
  <div class="sind">${ind}</div>
  <div class="sbody">
    <div class="stitle">${esc(s.agentId || "claude")}${s.title ? ` <span style="color:var(--t50);font-weight:400">${esc(s.title)}</span>` : ""}</div>
    ${sub ? `<div class="ssub">${sub}</div>` : ""}
    ${subagentRow}
  </div>
  <div class="sright">${pill}<span class="stime ${tCls}">${fmt(ms)}</span></div>
</div>`;
}

function renderRows() {
  if (currentMode !== "panel") return;
  const listEl = document.getElementById("slist");
  if (!listEl) return;

  const vis = sessions.filter(s => !s.headless);
  const sorted = [...vis].sort((a,b) => (PRIO[b.state]||0) - (PRIO[a.state]||0));
  const curIds = new Set(sorted.map(s => s.sessionId));

  // Capture old IDs before re-render
  const wasIds = prevIds;
  prevIds = curIds;

  listEl.innerHTML = sorted.map(buildRow).join("");

  // Click handlers + stagger entry animation (claude-island: 0/50/100/150ms)
  let delay = 0;
  for (const row of listEl.querySelectorAll(".srow")) {
    const sid = row.dataset.sid;
    // Animate new rows only
    if (idsChanged && wasIds !== null && !wasIds.has(sid)) {
      row.style.animationDelay = `${delay}ms`;
      row.classList.add("srow-new");
      row.addEventListener("animationend", () => row.classList.remove("srow-new"), { once: true });
      delay += 50; // claude-island stagger: 50ms
    }
    row.addEventListener("click", () => window.electronAPI.focusSession(sid));
  }
  idsChanged = false;

  if (currentMode === "panel" && !_isTransitioning()) {
    requestAnimationFrame(() => reportCardPositions());
  }
}

// ── 1s tick: refresh elapsed ──
setInterval(() => {
  if (currentMode === "panel" && !_isTransitioning()) renderRows();
  else if (currentMode === "orb") updateOrb();
}, 1000);

// ═══════════════════════════════════════════════════════
// IPC events
// ═══════════════════════════════════════════════════════
window.electronAPI.onSessionsUpdate((s) => {
  sessions = s;
  idsChanged = true;
  const vis = sessions.filter(x => !x.headless);

  if (!vis.length) {
    if (currentMode !== "orb") setMode("orb");
    return;
  }

  if (currentMode === "orb") {
    updateOrb(); // Stay in orb, show updated state
  } else { // panel
    renderRows();
    updateCapsule();
    _syncPanelHeight();
  }

  updateOrb(); // Always keep orb display up to date
});

window.electronAPI.onCollapseToOrb(() => {
  if (currentMode !== "orb") setMode("orb");
});

window.electronAPI.onDndChange((on) => {
  const el = document.getElementById("dnd-bar");
  if (on) el.classList.add("on"); else el.classList.remove("on");
  _syncPanelHeight();
});

// Capsule bar double-click: panel → orb
document.getElementById("cap-bar").addEventListener("dblclick", (e) => {
  e.preventDefault();
  if (!dragging && currentMode === "panel") setMode("orb");
});

// ═══════════════════════════════════════════════════════
// Drag — #orb (circle, no corner gaps) and panel cap-bar
// ═══════════════════════════════════════════════════════
function onDragStart(e) {
  if (e.button !== 0) return;
  dragging = false; dragX = e.screenX; dragY = e.screenY;
}
document.getElementById("orb").addEventListener("mousedown", onDragStart);
document.getElementById("cap-bar").addEventListener("mousedown", (e) => {
  if (currentMode !== "panel") return;
  onDragStart(e);
});
document.addEventListener("mousemove", (e) => {
  if (!dragX && !dragY) return;
  const dx = e.screenX - dragX, dy = e.screenY - dragY;
  if (dx || dy) {
    dragging = true; dragX = e.screenX; dragY = e.screenY;
    window.electronAPI.dragWindow(dx, dy);
  }
});
document.addEventListener("mouseup", () => {
  const was = dragging;
  dragging = false; dragX = 0; dragY = 0;
  if (was) window.electronAPI.snapToEdge(window.screenX, window.screenY);
});

// ── ORB double-click → panel ──
document.getElementById("orb").addEventListener("dblclick", () => {
  if (!dragging) setMode("panel");
});

const FSCALE = { small: 0.85, medium: 1.0, large: 1.2 };
const ORB_SIZES = {
  small:  { outer: 38, inner: 38 },
  medium: { outer: 46, inner: 46 },
  large:  { outer: 58, inner: 58 },
};
window.electronAPI.onApplyPrefs(({ fontSize, orbSize }) => {
  if (fontSize) document.documentElement.style.setProperty("--font-scale", FSCALE[fontSize] ?? 1.0);
  if (orbSize) {
    const s = ORB_SIZES[orbSize] || ORB_SIZES.medium;
    _orbOuter = s.outer;
    document.documentElement.style.setProperty("--orb-outer", s.outer + "px");
    document.documentElement.style.setProperty("--orb-inner", s.inner + "px");
    if (currentMode === "orb") window.electronAPI.reportWindowSize(s.outer, s.outer);
  }
});

// ── Sound (Web Audio) ──
let _actx = null;
window.electronAPI.onPlaySound((name) => {
  try {
    if (!_actx) _actx = new AudioContext();
    _actx.resume().then(() => {
      const t = _actx.currentTime;
      function tone(f, s, d, g) {
        const o = _actx.createOscillator(), e = _actx.createGain();
        o.connect(e); e.connect(_actx.destination);
        o.type = "sine"; o.frequency.value = f;
        e.gain.setValueAtTime(0, s);
        e.gain.linearRampToValueAtTime(g, s+.008);
        e.gain.exponentialRampToValueAtTime(.0001, s+d);
        o.start(s); o.stop(s+d+.02);
      }
      if (name === "complete") {
        tone(523, t+.00, .45, .18); tone(659, t+.10, .45, .18); tone(784, t+.20, .55, .20);
      } else {
        tone(880, t, .35, .13);
      }
    });
  } catch {}
});

// ── Initial: tell main to resize to ORB ──
window.electronAPI.reportWindowSize(_orbOuter, _orbOuter);
