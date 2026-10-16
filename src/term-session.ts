import { Channel, invoke } from "@tauri-apps/api/core";

type Writer = (data: Uint8Array) => void;

/**
 * 单个 SSH 会话的前端封装：
 * - Rust 经 Tauri IPC Channel 推送原始字节（ArrayBuffer），转发给挂载的 xterm
 * - 终端未挂载/未激活时先积压在 backlog，避免丢输出
 */
export class TermSession {
  sessionId: number | null = null;
  private writers = new Set<Writer>();
  private backlog: Uint8Array[] = [];
  private closedListeners = new Set<() => void>();
  private closed = false;

  get alive() {
    return this.sessionId !== null && !this.closed;
  }

  async connect(
    hostId: number,
    cols: number,
    rows: number,
    onUnknownHost: (
      kind: "unknown_host" | "host_key_changed",
      fingerprint: string,
      message: string,
    ) => void,
    onError: (message: string) => void,
    onClosed: () => void,
  ): Promise<void> {
    const channel = new Channel<ArrayBuffer | string | { event?: string }>();
    channel.onmessage = (msg) => {
      if (msg instanceof ArrayBuffer) {
        const data = new Uint8Array(msg);
        if (this.writers.size === 0) this.backlog.push(data);
        else for (const w of this.writers) w(data);
        return;
      }
      // JSON 事件（closed 等）；tauri 可能已解析为对象，也可能还是字符串
      let ev: unknown = msg;
      if (typeof msg === "string") {
        try {
          ev = JSON.parse(msg);
        } catch {
          return;
        }
      }
      if (
        typeof ev === "object" &&
        ev !== null &&
        (ev as { event?: string }).event === "closed"
      ) {
        this.markClosed();
      }
    };
    this.onClosed(onClosed);

    try {
      this.sessionId = await invoke<number>("ssh_connect", {
        hostId,
        cols,
        rows,
        onEvent: channel,
      });
    } catch (e) {
      const err = parseAppError(e);
      if (
        (err.kind === "unknown_host" || err.kind === "host_key_changed") &&
        err.fingerprint
      ) {
        onUnknownHost(err.kind, err.fingerprint, err.message);
      }
      onError(err.message);
    }
  }

  /** 终端组件挂载时调用；返回反注册函数 */
  attach(writer: Writer): () => void {
    this.writers.add(writer);
    for (const chunk of this.backlog) writer(chunk);
    this.backlog = [];
    return () => {
      this.writers.delete(writer);
    };
  }

  onClosed(cb: () => void): () => void {
    if (this.closed) cb();
    this.closedListeners.add(cb);
    return () => {
      this.closedListeners.delete(cb);
    };
  }

  write(data: Uint8Array): void {
    if (!this.alive) return;
    invoke("ssh_input", { sessionId: this.sessionId, data: Array.from(data) }).catch(
      () => {},
    );
  }

  resize(cols: number, rows: number): void {
    if (!this.alive) return;
    invoke("ssh_resize", { sessionId: this.sessionId, cols, rows }).catch(() => {});
  }

  dispose(): void {
    if (this.sessionId !== null) {
      invoke("ssh_disconnect", { sessionId: this.sessionId }).catch(() => {});
    }
    this.sessionId = null;
    this.closed = true;
  }

  /** 重连前复位内部状态 */
  reset(): void {
    this.dispose();
    this.closedListeners.clear();
    this.closed = false;
  }

  private markClosed(): void {
    const wasClosed = this.closed;
    this.closed = true;
    this.sessionId = null;
    if (!wasClosed) for (const cb of this.closedListeners) cb();
  }
}

function parseAppError(e: unknown): { kind: string; message: string; fingerprint?: string } {
  if (typeof e === "object" && e !== null && "kind" in e) {
    const p = e as { kind: string; message?: string; fingerprint?: string };
    return { kind: p.kind, message: p.message ?? String(e), fingerprint: p.fingerprint };
  }
  return { kind: "other", message: String(e) };
}
