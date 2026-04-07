"use strict";

// ── Agent display config ──
const AGENT_ICONS = {
  "claude-code":  "◆",
  "codex":        "⚡",
  "cursor-agent": "◈",
  "copilot-cli":  "✦",
  "gemini":       "✿",
  "codebuddy":    "◉",
};

// State display: label, color, whether to show pulsing dot
const STATE_CONFIG = {
  working:      { label: "working",      color: "#5599ff", pulse: true  },
  thinking:     { label: "thinking",     color: "#a07fff", pulse: true  },
  juggling:     { label: "juggling",     color: "#5599ff", pulse: true  },
  sweeping:     { label: "sweeping",     color: "#80ccff", pulse: true  },
  carrying:     { label: "carrying",     color: "#80ccff", pulse: true  },
  error:        { label: "error",        color: "#ff5555", pulse: false },
  attention:    { label: "done",         color: "#55ee88", pulse: false },
  notification: { label: "notify",       color: "#ffcc44", pulse: true  },
  idle:         { label: "idle",         color: "#555577", pulse: false },
  sleeping:     { label: "sleeping",     color: "#444460", pulse: false },
};

let sessions = [];
let prevSessionIds = null; // null = first render, skip animation
let collapsed = false;

// ── Elapsed time formatting ──
function formatElapsed(ms) {
  const sec = Math.floor(ms / 1000);
  if (sec < 5)  return "just now";
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${String(sec % 60).padStart(2, "0")}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${String(min % 60).padStart(2, "0")}m`;
}

// ── Shorten home directory to ~ ──
function shortenPath(p) {
  if (!p) return "";
  // macOS / Linux
  const unixHome = p.match(/^(\/Users\/[^/]+|\/home\/[^/]+)/);
  if (unixHome) return "~" + p.slice(unixHome[0].length);
  // Windows
  const winHome = p.match(/^[A-Za-z]:\\Users\\[^\\]+/);
  if (winHome) return "~" + p.slice(winHome[0].length).replace(/\\/g, "/");
  return p;
}

// ── Report card screen positions to main process ──
function reportCardPositions() {
  const positions = {};
  for (const card of document.querySelectorAll("#list .card:not(.card-exit)")) {
    const rect = card.getBoundingClientRect();
    positions[card.dataset.sessionId] = {
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      centerY: Math.round((rect.top + rect.bottom) / 2),
    };
  }
  window.electronAPI.reportCardPositions(positions);
}

// ── Report desired window height to main process (max 5 cards) ──
const MAX_VISIBLE_CARDS = 5;
function reportWindowHeight() {
  const headerEl      = document.querySelector(".header");
  const opacityPanelEl = document.getElementById("opacity-panel");
  const listEl        = document.getElementById("list");
  if (!headerEl || !listEl) return;

  const opacityPanelH = (opacityPanelEl && opacityPanelEl.classList.contains("visible"))
    ? opacityPanelEl.offsetHeight + 1  // +1 for border-bottom
    : 0;

  // Collapsed: only header (+ opacity panel if open)
  if (collapsed) {
    window.electronAPI.reportListHeight(headerEl.offsetHeight + 2 + opacityPanelH);
    return;
  }

  const cards = [...listEl.querySelectorAll(".card:not(.card-exit)")];
  const headerH = headerEl.offsetHeight + 1; // +1 for border-bottom

  if (cards.length === 0) {
    // No sessions: collapse to header strip only
    window.electronAPI.reportListHeight(headerEl.offsetHeight + 2 + opacityPanelH); // +2 for .app top/bottom border
    return;
  }

  const GAP      = 5;  // gap: 5px on .list
  const LIST_PAD = 16; // padding: 8px top + 8px bottom on .list
  const visible  = cards.slice(0, MAX_VISIBLE_CARDS);
  const cardsH   = visible.reduce((sum, c) => sum + c.offsetHeight, 0)
                   + GAP * (visible.length - 1);
  window.electronAPI.reportListHeight(headerH + opacityPanelH + LIST_PAD + cardsH);
}

// ── Render all session cards ──
function render() {
  const listEl  = document.getElementById("list");
  const countEl = document.getElementById("count");

  const visible = sessions.filter(s => !s.headless);

  if (visible.length === 0) {
    countEl.textContent = "";
    countEl.className = "count";
    listEl.innerHTML = "";
    prevSessionIds = new Set();
    requestAnimationFrame(() => reportWindowHeight());
    return;
  }

  countEl.textContent = `${visible.length} active`;
  countEl.className = "count has-active";

  // Sort: highest priority state first, then most recent
  const PRIORITY = { error: 8, notification: 7, sweeping: 6, attention: 5, carrying: 4, juggling: 4, working: 3, thinking: 2, idle: 1, sleeping: 0 };
  const sorted = [...visible].sort((a, b) => {
    const pa = PRIORITY[a.state] || 0;
    const pb = PRIORITY[b.state] || 0;
    if (pb !== pa) return pb - pa;
    return b.updatedAt - a.updatedAt;
  });

  const now = Date.now();

  // Diff: only update cards that changed to avoid DOM thrashing
  const currentIds = new Set(sorted.map(s => s.sessionId));
  const existing = [...listEl.querySelectorAll(".card:not(.card-exit)")];
  const newCards = sorted.map((s, i) => {
    const cfg  = STATE_CONFIG[s.state] || STATE_CONFIG.idle;
    const icon = AGENT_ICONS[s.agentId] || "◆";
    const cwd  = shortenPath(s.cwd);
    const name = s.agentId || "unknown";
    const elapsed = formatElapsed(now - s.updatedAt);

    // Reuse existing card element if it's the same session
    let card = (existing[i] && existing[i].dataset.sessionId === s.sessionId)
      ? existing[i]
      : null;

    if (!card) {
      card = document.createElement("div");
      card.className = "card";
      card.dataset.sessionId = s.sessionId;
      card.addEventListener("click", () => {
        window.electronAPI.focusSession(s.sessionId);
      });
    }

    // Always update state-related classes
    card.className = ["card", `state-${s.state}`].join(" ");

    // Slide-in animation for newly appeared sessions
    if (prevSessionIds !== null && !prevSessionIds.has(s.sessionId)) {
      card.classList.add("card-enter");
      card.addEventListener("animationend", () => card.classList.remove("card-enter"), { once: true });
    }

    const safeTitle = s.title ? s.title.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;") : "";
    const hasCwd = !!cwd;

    card.innerHTML = `
      <div class="card-top">
        <span class="agent-icon">${icon}</span>
        <span class="agent-name">${name}</span>
        <span class="state-badge" style="color:${cfg.color}">
          <span class="dot${cfg.pulse ? " pulse" : ""}" style="background:${cfg.color}"></span>
          ${cfg.label}
        </span>
      </div>
      ${safeTitle ? `<div class="card-title">${safeTitle}</div>` : ""}
      ${hasCwd ? `<div class="card-cwd${safeTitle ? " card-cwd-sub" : ""}" title="${s.cwd || ""}">${cwd}</div>` : ""}
      ${s.subagentCount > 0 ? `<div class="card-subagents">└─ ⚡ subagent${s.subagentCount > 1 ? ` ×${s.subagentCount}` : ""}</div>` : ""}
      <div class="card-foot">
        <span class="elapsed">${elapsed}</span>
        ${s.host ? `<span class="host-badge">⬡ ${s.host}</span>` : ""}
      </div>`;

    return card;
  });

  // FLIP step 1: snapshot current positions before DOM update
  const prevPositions = new Map();
  for (const card of existing) {
    prevPositions.set(card.dataset.sessionId, card.getBoundingClientRect().top);
  }

  // Exit animation for sessions that just disappeared
  const newlyExiting = [];
  if (prevSessionIds !== null) {
    for (const card of existing) {
      const id = card.dataset.sessionId;
      if (prevSessionIds.has(id) && !currentIds.has(id)) {
        card.classList.add("card-exit");
        card.addEventListener("animationend", () => card.remove(), { once: true });
        newlyExiting.push(card);
      }
    }
  }
  // Preserve cards already mid-exit-animation from previous renders
  const alreadyExiting = [...listEl.querySelectorAll(".card-exit")].filter(c => !newlyExiting.includes(c));

  // Replace list contents, keeping exit-animating cards in DOM
  listEl.replaceChildren(...newCards, ...alreadyExiting, ...newlyExiting);
  prevSessionIds = currentIds;

  // FLIP step 2: animate cards that moved to a new position
  for (const card of newCards) {
    if (card.classList.contains("card-enter")) continue; // new card already has slide-in
    const oldTop = prevPositions.get(card.dataset.sessionId);
    if (oldTop === undefined) continue;
    const delta = oldTop - card.getBoundingClientRect().top;
    if (Math.abs(delta) < 1) continue; // didn't move
    // Invert: jump back to old position instantly
    card.style.transform = `translateY(${delta}px)`;
    card.style.transition = "none";
    // Play: next frame, animate to new position
    requestAnimationFrame(() => requestAnimationFrame(() => {
      card.style.transition = "transform 0.28s ease";
      card.style.transform = "";
      card.addEventListener("transitionend", () => {
        card.style.transform = "";
        card.style.transition = "";
      }, { once: true });
    }));
  }

  // Report card positions and window height to main process
  requestAnimationFrame(() => { reportCardPositions(); reportWindowHeight(); });
}

// ── 1s interval: refresh elapsed times without waiting for new sessions-update ──
setInterval(render, 1000);

// ── Receive sessions from main process ──
window.electronAPI.onSessionsUpdate((newSessions) => {
  sessions = newSessions;
  render();
});

// ── DND state ──
window.electronAPI.onDndChange((enabled) => {
  const bar = document.getElementById("dnd-bar");
  if (enabled) {
    bar.classList.add("visible");
  } else {
    bar.classList.remove("visible");
  }
});

// ── Menu button ──
document.getElementById("menu-btn").addEventListener("click", () => {
  window.electronAPI.showContextMenu();
});

// ── Collapse button ──
document.getElementById("collapse-btn").addEventListener("click", () => {
  collapsed = !collapsed;
  const appEl = document.querySelector(".app");
  const collapseBtn = document.getElementById("collapse-btn");
  const opacityPanel = document.getElementById("opacity-panel");
  if (collapsed) {
    appEl.classList.add("collapsed");
    collapseBtn.textContent = "▴";
    collapseBtn.title = "Expand";
    opacityPanel.classList.remove("visible");
  } else {
    appEl.classList.remove("collapsed");
    collapseBtn.textContent = "▾";
    collapseBtn.title = "Collapse";
  }
  requestAnimationFrame(() => reportWindowHeight());
  window.electronAPI.setCollapsed(collapsed);
});

// ── Opacity button ──
document.getElementById("opacity-btn").addEventListener("click", () => {
  const opacityPanel = document.getElementById("opacity-panel");
  opacityPanel.classList.toggle("visible");
  requestAnimationFrame(() => reportWindowHeight());
});

document.getElementById("opacity-slider").addEventListener("input", (e) => {
  const val = parseFloat(e.target.value);
  document.getElementById("opacity-value").textContent = Math.round(val * 100) + "%";
  window.electronAPI.setOpacity(val);
});

// ── Theme & font size ──
const FONT_SCALE_MAP = { small: 0.85, medium: 1.0, large: 1.2 };
window.electronAPI.onApplyPrefs(({ theme, fontSize, collapsed: initCollapsed, windowOpacity: initOpacity }) => {
  if (theme)    document.documentElement.setAttribute("data-theme", theme);
  if (fontSize) document.documentElement.style.setProperty("--font-scale", FONT_SCALE_MAP[fontSize] ?? 1.0);
  if (typeof initCollapsed === "boolean" && initCollapsed !== collapsed) {
    collapsed = initCollapsed;
    const appEl = document.querySelector(".app");
    const collapseBtn = document.getElementById("collapse-btn");
    if (collapsed) {
      appEl.classList.add("collapsed");
      collapseBtn.textContent = "▴";
      collapseBtn.title = "Expand";
    } else {
      appEl.classList.remove("collapsed");
      collapseBtn.textContent = "▾";
      collapseBtn.title = "Collapse";
    }
    requestAnimationFrame(() => reportWindowHeight());
  }
  if (typeof initOpacity === "number") {
    const slider = document.getElementById("opacity-slider");
    const valEl  = document.getElementById("opacity-value");
    slider.value = String(initOpacity);
    valEl.textContent = Math.round(initOpacity * 100) + "%";
  }
});

// ── Sound synthesis (Web Audio API — no files needed) ──
let _audioCtx = null;
function getAudioCtx() {
  if (!_audioCtx) _audioCtx = new AudioContext();
  return _audioCtx;
}
window.electronAPI.onPlaySound((name) => {
  try {
    const actx = getAudioCtx();
    actx.resume().then(() => {
      function tone(freq, start, duration, peakGain) {
        const osc = actx.createOscillator();
        const env = actx.createGain();
        osc.connect(env); env.connect(actx.destination);
        osc.type = "sine";
        osc.frequency.value = freq;
        env.gain.setValueAtTime(0, start);
        env.gain.linearRampToValueAtTime(peakGain, start + 0.008);
        env.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        osc.start(start); osc.stop(start + duration + 0.02);
      }
      const t = actx.currentTime;
      if (name === "complete") {
        // Ascending triad: C5 → E5 → G5
        tone(523, t + 0.00, 0.45, 0.18);
        tone(659, t + 0.10, 0.45, 0.18);
        tone(784, t + 0.20, 0.55, 0.20);
      } else {
        // Single soft ping: A5
        tone(880, t + 0.00, 0.35, 0.13);
      }
    });
  } catch { /* audio context may not be available */ }
});

// ── Initial render (empty state) ──
render();
