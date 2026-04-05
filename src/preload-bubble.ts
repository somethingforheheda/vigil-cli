// src/preload-bubble.ts — Bubble window contextBridge
// Exposes bubbleAPI to the permission bubble renderer.

const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");
import { IpcChannels } from "./constants/ipc-channels";

contextBridge.exposeInMainWorld("bubbleAPI", {
  onPermissionShow: (cb: (data: unknown) => void) =>
    ipcRenderer.on(IpcChannels.PERMISSION_SHOW, (_: Electron.IpcRendererEvent, data: unknown) => cb(data)),
  decide: (behavior: string) => ipcRenderer.send(IpcChannels.PERMISSION_DECIDE, behavior),
  onPermissionHide: (cb: () => void) =>
    ipcRenderer.on(IpcChannels.PERMISSION_HIDE, () => cb()),
  reportHeight: (h: number) => ipcRenderer.send(IpcChannels.BUBBLE_HEIGHT, h),
});
