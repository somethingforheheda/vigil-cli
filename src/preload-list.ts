// src/preload-list.ts — List window contextBridge
// Exposes electronAPI to the renderer process for the session list UI.

const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");
import type { SessionSnapshot } from "./types/agent";
import { IpcChannels } from "./constants/ipc-channels";

type Prefs = { theme?: string; fontSize?: string; collapsed?: boolean; windowOpacity?: number };
type CardPositionMap = Record<string, { top: number; bottom: number; centerY: number }>;

contextBridge.exposeInMainWorld("electronAPI", {
  onSessionsUpdate: (cb: (sessions: SessionSnapshot[]) => void) => {
    ipcRenderer.on(IpcChannels.SESSIONS_UPDATE, (_: Electron.IpcRendererEvent, sessions: SessionSnapshot[]) => cb(sessions));
  },
  focusSession: (sessionId: string) => ipcRenderer.send(IpcChannels.FOCUS_SESSION, sessionId),
  showContextMenu: () => ipcRenderer.send(IpcChannels.SHOW_CONTEXT_MENU),
  onDndChange: (cb: (enabled: boolean) => void) =>
    ipcRenderer.on(IpcChannels.DND_CHANGE, (_: Electron.IpcRendererEvent, enabled: boolean) => cb(enabled)),
  onApplyPrefs: (cb: (prefs: Prefs) => void) =>
    ipcRenderer.on(IpcChannels.APPLY_PREFS, (_: Electron.IpcRendererEvent, prefs: Prefs) => cb(prefs)),
  reportCardPositions: (positions: CardPositionMap) =>
    ipcRenderer.send(IpcChannels.CARD_POSITIONS, positions),
  reportListHeight: (height: number) =>
    ipcRenderer.send(IpcChannels.LIST_CONTENT_HEIGHT, height),
  setCollapsed: (collapsed: boolean) =>
    ipcRenderer.send(IpcChannels.LIST_COLLAPSED, collapsed),
  setOpacity: (opacity: number) =>
    ipcRenderer.send(IpcChannels.SET_OPACITY, opacity),
  onPlaySound: (cb: (name: string) => void) =>
    ipcRenderer.on("play-sound", (_: Electron.IpcRendererEvent, name: string) => cb(name)),
  // ── Drag / snap / mode collapse ──
  dragWindow: (dx: number, dy: number) =>
    ipcRenderer.send("move-window", { dx, dy }),
  snapToEdge: (x: number, y: number) =>
    ipcRenderer.send("snap-to-edge", { x, y }),
  onCollapseToOrb: (cb: () => void) =>
    ipcRenderer.on(IpcChannels.COLLAPSE_TO_ORB, () => cb()),
  reportWindowSize: (width: number, height: number) =>
    ipcRenderer.send(IpcChannels.WINDOW_SIZE, { width, height }),
});
