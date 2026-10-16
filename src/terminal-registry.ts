import type { Terminal } from "@xterm/xterm";

/** tabId -> xterm 实例，供 AI 面板读取终端最近输出 */
const registry = new Map<number, Terminal>();

export function registerTerminal(tabId: number, term: Terminal): void {
  registry.set(tabId, term);
}

export function unregisterTerminal(tabId: number): void {
  registry.delete(tabId);
}

/** 序列化某个终端最近 N 行（含 scrollback），末尾空行裁掉 */
export function serializeRecent(tabId: number, maxLines = 400): string | null {
  const term = registry.get(tabId);
  if (!term) return null;
  const buf = term.buffer.active;
  const total = buf.length;
  const lines: string[] = [];
  for (let i = Math.max(0, total - maxLines); i < total; i++) {
    const line = buf.getLine(i);
    if (line) lines.push(line.translateToString(true));
  }
  return lines.join("\n").replace(/\n+$/, "");
}

/** 设置变更时对所有存活终端实时生效 */
export function applyTerminalOptions(opts: {
  fontSize?: number;
  cursorBlink?: boolean;
  scrollback?: number;
}): void {
  for (const term of registry.values()) {
    if (opts.fontSize !== undefined) term.options.fontSize = opts.fontSize;
    if (opts.cursorBlink !== undefined) term.options.cursorBlink = opts.cursorBlink;
    if (opts.scrollback !== undefined) term.options.scrollback = opts.scrollback;
    term.refresh(0, term.rows - 1);
  }
}
