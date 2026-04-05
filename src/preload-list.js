"use strict";
// src/preload-list.ts — List window contextBridge
// Exposes electronAPI to the renderer process for the session list UI.
Object.defineProperty(exports, "__esModule", { value: true });
const { contextBridge, ipcRenderer } = require("electron");
const ipc_channels_1 = require("./constants/ipc-channels");
contextBridge.exposeInMainWorld("electronAPI", {
    onSessionsUpdate: (cb) => {
        ipcRenderer.on(ipc_channels_1.IpcChannels.SESSIONS_UPDATE, (_, sessions) => cb(sessions));
    },
    focusSession: (sessionId) => ipcRenderer.send(ipc_channels_1.IpcChannels.FOCUS_SESSION, sessionId),
    showContextMenu: () => ipcRenderer.send(ipc_channels_1.IpcChannels.SHOW_CONTEXT_MENU),
    onDndChange: (cb) => ipcRenderer.on(ipc_channels_1.IpcChannels.DND_CHANGE, (_, enabled) => cb(enabled)),
    onApplyPrefs: (cb) => ipcRenderer.on(ipc_channels_1.IpcChannels.APPLY_PREFS, (_, prefs) => cb(prefs)),
    reportCardPositions: (positions) => ipcRenderer.send(ipc_channels_1.IpcChannels.CARD_POSITIONS, positions),
    reportListHeight: (height) => ipcRenderer.send(ipc_channels_1.IpcChannels.LIST_CONTENT_HEIGHT, height),
    onPlaySound: (cb) => ipcRenderer.on("play-sound", (_, name) => cb(name)),
});
