// App preferences — persisted to vigilcli-prefs.json

export interface AppPrefs {
  x?: number;
  y?: number;
  lang?: "en" | "zh";
  showTray?: boolean;
  showDock?: boolean;
  autoStartWithClaude?: boolean;
  bubbleFollowWindow?: boolean;
  hideBubbles?: boolean;
  showSessionId?: boolean;
  soundMuted?: boolean;
  theme?: string;
  fontSize?: string;
  orbSize?: string;
  windowOpacity?: number;
  listCollapsed?: boolean;
}
