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
let peekTimer = null;   // 8s auto-return peek→orb
document.body.dataset.mode = "orb";

// ── Drag ──
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
function setMode(mode) {
  if (currentMode === mode) return;
  const prev = currentMode;
  currentMode = mode;

  const capEl  = document.getElementById("cap");
  const bodyEl = document.getElementById("cap-body");

  if (mode === "orb") {
    clearTimeout(peekTimer); peekTimer = null;
    stopSpinner();

    if (prev === "panel") {
      // Panel → ORB: content fades out fast, then capsule collapses
      _collapseBody(bodyEl, () => {
        if (capEl) capEl.classList.remove("panel");
        document.body.dataset.mode = "orb";
        window.electronAPI.reportWindowSize(52, 52);
      });
    } else {
      // Peek → ORB
      document.body.dataset.mode = "orb";
      window.electronAPI.reportWindowSize(52, 52);
    }

  } else if (mode === "peek") {
    clearTimeout(peekTimer); peekTimer = null;

    if (prev === "panel") {
      // Panel → Peek: collapse body first, then narrow capsule
      _collapseBody(bodyEl, () => {
        if (capEl) capEl.classList.remove("panel");
        document.body.dataset.mode = "peek";
        if (userWidth) capEl.style.width = userWidth + "px";
        window.electronAPI.reportWindowSize(capWidth(), 40);
        updateCapsule();
        startSpinner();
        resetPeekTimer();
      });
    } else {
      // ORB → Peek
      document.body.dataset.mode = "peek";
      if (userWidth) capEl.style.width = userWidth + "px";
      updateCapsule();
      startSpinner();
      window.electronAPI.reportWindowSize(capWidth(), 40);
      resetPeekTimer();
    }

  } else { // panel
    clearTimeout(peekTimer); peekTimer = null;

    // Peek → Panel: widen capsule + grow body downward
    document.body.dataset.mode = "panel";
    if (capEl) capEl.classList.add("panel");
    if (userWidth) capEl.style.width = userWidth + "px";
    startSpinner();

    // Render content first (invisible, height 0)
    renderRows();
    updateCapsule();

    // Then animate open (nextTick so CSS transition picks up)
    requestAnimationFrame(() => requestAnimationFrame(() => {
      _expandBody(bodyEl, () => {
        reportCardPositions();
        window.electronAPI.reportWindowSize(capWidth(), panelHeight());
      });
    }));
  }
}

// Expand body downward — claude-island spring(0.42, 0.8)
function _expandBody(bodyEl, onDone) {
  if (!bodyEl) { if (onDone) onDone(); return; }
  const target = bodyEl.scrollHeight || 200;
  bodyEl.style.transition = "max-height .42s cubic-bezier(.34,1.25,.64,1)";
  bodyEl.style.maxHeight = target + "px";

  // Content fade-in: scale(.85→1) + opacity(0→1) after body starts opening
  // claude-island: .scale(0.8, anchor:.top).combined(.opacity) .smooth(0.35)
  const slist = document.getElementById("slist");
  if (slist) {
    slist.style.opacity = "0";
    slist.style.transform = "scaleY(0.88)";
    slist.style.transformOrigin = "top";
    slist.style.transition = "none";
    setTimeout(() => {
      slist.style.transition = "opacity .35s cubic-bezier(.25,.46,.45,.94), transform .35s cubic-bezier(.25,.46,.45,.94)";
      slist.style.opacity = "1";
      slist.style.transform = "scaleY(1)";
    }, 60); // slight delay so body starts opening first
  }

  bodyEl.addEventListener("transitionend", function handler() {
    bodyEl.removeEventListener("transitionend", handler);
    bodyEl.style.maxHeight = "none";
    if (onDone) onDone();
  }, { once: true });
}

// Collapse body — claude-island spring(0.45, 1.0) no overshoot
function _collapseBody(bodyEl, onDone) {
  if (!bodyEl || bodyEl.scrollHeight === 0) { if (onDone) onDone(); return; }

  // Content fades out fast first (0.15s) — claude-island removal transition
  const slist = document.getElementById("slist");
  if (slist) {
    slist.style.transition = "opacity .15s cubic-bezier(.25,.46,.45,.94)";
    slist.style.opacity = "0";
  }

  setTimeout(() => {
    // Then collapse height
    const cur = bodyEl.scrollHeight;
    bodyEl.style.maxHeight = cur + "px";
    bodyEl.style.transition = "none";
    requestAnimationFrame(() => requestAnimationFrame(() => {
      bodyEl.style.transition = "max-height .45s cubic-bezier(.25,.46,.45,.94)";
      bodyEl.style.maxHeight = "0";
      bodyEl.addEventListener("transitionend", function h() {
        bodyEl.removeEventListener("transitionend", h);
        // Reset slist styles
        if (slist) { slist.style.opacity = ""; slist.style.transform = ""; slist.style.transition = ""; }
        if (onDone) onDone();
      }, { once: true });
    }));
  }, 120);
}

function resetPeekTimer() {
  clearTimeout(peekTimer);
  const vis = sessions.filter(s => !s.headless);
  if (vis.every(s => s.state === "idle" || s.state === "sleeping")) {
    peekTimer = setTimeout(() => { peekTimer = null; setMode("orb"); }, 8000);
  }
}

// ═══════════════════════════════════════════════════════
// ORB dots update
// ═══════════════════════════════════════════════════════
function updateOrb() {
  const orb  = document.getElementById("orb");
  const dots = document.getElementById("orb-dots");
  if (!orb || !dots) return;
  const vis = sessions.filter(s => !s.headless);
  const hasErr  = vis.some(s => s.state === "error");
  const hasPerm = vis.some(s => s.state === "notification");
  const hasAct  = vis.some(s => ["working","thinking","juggling"].includes(s.state));
  orb.className = "orb" + (hasErr ? " s-err" : hasPerm ? " s-perm" : hasAct ? " s-active" : "");
  dots.innerHTML = vis.slice(0, 5).map(s => {
    const c = s.state === "error" ? " err" : s.state === "notification" ? " perm"
      : ["working","thinking","juggling"].includes(s.state) ? " active" : "";
    return `<span class="orb-dot${c}"></span>`;
  }).join("") + (vis.length > 5 ? `<span style="font-size:8px;color:#555">+${vis.length - 5}</span>` : "");
}

// ═══════════════════════════════════════════════════════
// Capsule bar update (PEEK / PANEL top indicator)
// ═══════════════════════════════════════════════════════
function updateCapsule() {
  const indEl   = document.getElementById("cap-ind");
  const agentEl = document.getElementById("cap-agent");
  const lineEl  = document.getElementById("cap-line");
  const toolEl  = document.getElementById("cap-tool");
  const statEl  = document.getElementById("cap-status");
  if (!indEl) return;

  const vis = sessions.filter(s => !s.headless);

  // ── PANEL mode: minimal header — just session state dots on the right ──
  if (currentMode === "panel") {
    indEl.innerHTML = "";
    agentEl.style.cssText = "color:var(--t25)";
    agentEl.textContent = "VigilCLI";
    lineEl.className = "";
    statEl.textContent = "";
    statEl.removeAttribute("style");

    // Dots: one per session, colored by state (max 8, then +N)
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
    return;
  }

  // ── PEEK mode: show most active session info ──
  agentEl.removeAttribute("style");
  toolEl.style.cssText = "";

  if (!vis.length) {
    indEl.innerHTML = `<span class="ind-dot"></span>`;
    agentEl.textContent = "VigilCLI";
    lineEl.className = "";
    toolEl.textContent = "";
    statEl.textContent = "";
    statEl.removeAttribute("style");
    return;
  }

  const top = [...vis].sort((a,b) => (PRIO[b.state]||0) - (PRIO[a.state]||0))[0];
  const isActive = ["working","thinking","juggling"].includes(top.state);
  const isPerm   = top.state === "notification";
  const isErr    = top.state === "error";
  const isDone   = top.state === "attention";

  if (isActive) {
    indEl.innerHTML = `<span class="spin" style="color:var(--orange)">${SPIN[_spinIdx]}</span>`;
  } else if (isPerm) {
    indEl.innerHTML = `<span class="ind-dot a"></span>`;
  } else if (isErr) {
    indEl.innerHTML = `<span class="ind-dot r"></span>`;
  } else if (isDone) {
    indEl.innerHTML = `<span class="ind-dot g"></span>`;
  } else {
    indEl.innerHTML = `<span class="ind-dot"></span>`;
  }

  agentEl.textContent = top.agentId || "claude";
  if (top.title) {
    agentEl.innerHTML = `${esc(top.agentId || "claude")} <span style="color:var(--t50);font-weight:400">${esc(top.title)}</span>`;
  }
  lineEl.className = isActive ? "running" : "";
  toolEl.textContent = (isActive && top.currentTool) ? top.currentTool : "";

  if (isPerm) {
    statEl.textContent = "permission";
    statEl.style.cssText = "color:var(--amber);background:rgba(255,178,0,.1)";
  } else if (isErr) {
    statEl.textContent = "error";
    statEl.style.cssText = "color:var(--red);background:rgba(255,77,77,.1)";
  } else if (isActive) {
    statEl.textContent = top.state;
    statEl.style.cssText = "color:var(--orange);background:rgba(217,120,87,.1)";
  } else {
    statEl.textContent = "";
    statEl.removeAttribute("style");
  }
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

  if (currentMode === "panel") {
    requestAnimationFrame(() => reportCardPositions());
  }
}

// ── 1s tick: refresh elapsed ──
setInterval(() => {
  if (currentMode === "panel") renderRows();
  else if (currentMode === "peek") updateCapsule();
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
    setMode("peek");
  } else if (currentMode === "peek") {
    updateCapsule();
    resetPeekTimer();
  } else {
    renderRows();
    updateCapsule();
    // Resize if height changed
    requestAnimationFrame(() => window.electronAPI.reportListHeight(panelHeight()));
  }

  updateOrb();
});

window.electronAPI.onCollapseToOrb(() => {
  if (currentMode !== "orb") setMode("orb");
});

window.electronAPI.onDndChange((on) => {
  const el = document.getElementById("dnd-bar");
  if (on) el.classList.add("on"); else el.classList.remove("on");
  if (currentMode === "panel") requestAnimationFrame(() => window.electronAPI.reportListHeight(panelHeight()));
});

// Capsule bar click: peek ↔ panel
document.getElementById("cap-bar").addEventListener("click", (e) => {
  if (dragging) return;
  if (currentMode === "peek")  setMode("panel");
  else if (currentMode === "panel") setMode("peek");
});

// Apply prefs (theme/fontSize)
const FSCALE = { small: 0.85, medium: 1.0, large: 1.2 };
window.electronAPI.onApplyPrefs(({ fontSize }) => {
  if (fontSize) document.documentElement.style.setProperty("--font-scale", FSCALE[fontSize] ?? 1.0);
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

// ═══════════════════════════════════════════════════════
// Drag (manual — no webkit-app-region)
// ═══════════════════════════════════════════════════════
function onDragStart(e) {
  if (e.button !== 0) return;
  dragging = false; dragX = e.screenX; dragY = e.screenY;
}
document.getElementById("orb-container").addEventListener("mousedown", onDragStart);
document.getElementById("cap-bar").addEventListener("mousedown", (e) => {
  // In panel mode the bar has webkit-app-region:drag, native drag takes over.
  // In peek mode we do manual drag.
  if (currentMode !== "peek") return;
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

// ── ORB click → peek ──
document.getElementById("orb-container").addEventListener("click", () => {
  if (!dragging) setMode("peek");
});

// ═══════════════════════════════════════════════════════
// Resize capsule width by dragging right edge
// ═══════════════════════════════════════════════════════
let userWidth = null;       // user-set override (null = use default 300/340)
let isResizing = false;
const CAP_MIN_W = 220, CAP_MAX_W = 520, RESIZE_ZONE = 8;

function capWidth()   { return userWidth || (currentMode === "panel" ? 340 : 300); }
function capHeight()  { return currentMode === "panel" ? panelHeight() : 40; }

const capEl = document.getElementById("cap");

// Change cursor when hovering near right edge
capEl.addEventListener("mousemove", (e) => {
  if (isResizing || dragging) return;
  const rect = capEl.getBoundingClientRect();
  capEl.style.cursor = e.clientX >= rect.right - RESIZE_ZONE ? "ew-resize" : "";
});
capEl.addEventListener("mouseleave", () => {
  if (!isResizing) capEl.style.cursor = "";
});

// Start resize on mousedown near right edge
capEl.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  const rect = capEl.getBoundingClientRect();
  if (e.clientX < rect.right - RESIZE_ZONE) return;

  e.preventDefault();
  e.stopPropagation();
  isResizing = true;

  const startX = e.clientX;
  const startW = rect.width;

  // Suspend width transition so resize feels instant / snappy
  capEl.style.transition = "border-radius .35s cubic-bezier(.34,1.25,.64,1)";

  function onMove(ev) {
    const newW = Math.max(CAP_MIN_W, Math.min(CAP_MAX_W, startW + (ev.clientX - startX)));
    userWidth = newW;
    capEl.style.width = newW + "px";
    window.electronAPI.reportWindowSize(newW, capHeight());
  }

  function onUp() {
    isResizing = false;
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    capEl.style.transition = "";  // restore CSS transition
    capEl.style.cursor = "";
  }

  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
});

// ── Initial: tell main to resize to ORB ──
window.electronAPI.reportWindowSize(52, 52);
