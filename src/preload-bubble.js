"use strict";
// src/preload-bubble.ts — Bubble window contextBridge
// Exposes bubbleAPI to the permission bubble renderer.
Object.defineProperty(exports, "__esModule", { value: true });
const { contextBridge, ipcRenderer } = require("electron");
const ipc_channels_1 = require("./constants/ipc-channels");
contextBridge.exposeInMainWorld("bubbleAPI", {
    onPermissionShow: (cb) => ipcRenderer.on(ipc_channels_1.IpcChannels.PERMISSION_SHOW, (_, data) => cb(data)),
    decide: (behavior) => ipcRenderer.send(ipc_channels_1.IpcChannels.PERMISSION_DECIDE, behavior),
    onPermissionHide: (cb) => ipcRenderer.on(ipc_channels_1.IpcChannels.PERMISSION_HIDE, () => cb()),
    reportHeight: (h) => ipcRenderer.send(ipc_channels_1.IpcChannels.BUBBLE_HEIGHT, h),
    reportSize: (size) => ipcRenderer.send(ipc_channels_1.IpcChannels.BUBBLE_HEIGHT, size),
});
