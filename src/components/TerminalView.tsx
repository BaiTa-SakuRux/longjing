import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { Tab } from "../types";
import { useStore } from "../store";
import { registerTerminal, unregisterTerminal } from "../terminal-registry";

const termOptions = {
  cursorBlink: true,
  fontSize: 14,
  fontFamily: '"Cascadia Mono", Consolas, "Courier New", monospace',
  theme: {
    background: "#0a0a0a",
    foreground: "#e5e5e5",
    cursor: "#22d3ee",
    selectionBackground: "#334155",
  },
  scrollback: 5000,
} as const;

export function TerminalView({ tab, active }: { tab: Tab; active: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const stateRef = useRef(tab.state);
  stateRef.current = tab.state;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 用户设置覆盖默认值
    const s = useStore.getState().terminalSettings;
    const term = new Terminal({
      ...termOptions,
      fontSize: s.fontSize,
      cursorBlink: s.cursorBlink,
      scrollback: s.scrollback,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    registerTerminal(tab.id, term);
    termRef.current = term;
    fitRef.current = fit;

    const encoder = new TextEncoder();
    const detach = tab.session.attach((data) => term.write(data));
    const dataSub = term.onData((d) => tab.session.write(encoder.encode(d)));
    const resizeSub = term.onResize(({ cols, rows }) => tab.session.resize(cols, rows));
    const offClosed = tab.session.onClosed(() => {
      term.write("\r\n\x1b[90m\x1b[2m—— 连接已断开 ——\x1b[0m\r\n");
    });

    tryFit(fit, container);
    tab.session.resize(term.cols, term.rows);
    term.focus();

    const ro = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        if (tryFit(fit, container) && stateRef.current === "connected") {
          tab.session.resize(term.cols, term.rows);
        }
      });
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      offClosed();
      detach();
      dataSub.dispose();
      resizeSub.dispose();
      unregisterTerminal(tab.id);
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id]);

  // 切换标签时重新 fit + 聚焦（隐藏期间尺寸为 0，xterm 无法自动感知）
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    const fit = fitRef.current;
    const term = termRef.current;
    if (!container || !fit || !term) return;
    requestAnimationFrame(() => {
      if (tryFit(fit, container) && stateRef.current === "connected") {
        tab.session.resize(term.cols, term.rows);
      }
      term.focus();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return (
    <div className="relative h-full w-full bg-[#0a0a0a]">
      <div ref={containerRef} className="h-full w-full px-2 py-1" />
      {tab.state !== "connected" && <Overlay tab={tab} />}
    </div>
  );
}

/** 容器有尺寸才 fit，返回是否成功 */
function tryFit(fit: FitAddon, container: HTMLElement): boolean {
  if (container.clientWidth === 0 || container.clientHeight === 0) return false;
  try {
    fit.fit();
    return true;
  } catch {
    return false;
  }
}

function Overlay({ tab }: { tab: Tab }) {
  const retry = useStore((s) => s.retryTab);
  const closeTab = useStore((s) => s.closeTab);

  if (tab.state === "connecting") {
    return (
      <Center>
        <p className="text-sm text-amber-300">
          正在连接 {tab.host.username}@{tab.host.host}:{tab.host.port} …
        </p>
      </Center>
    );
  }

  return (
    <Center>
      <p className="mb-1 max-w-md break-all text-sm text-rose-400">
        {tab.errorMessage ?? "连接已断开"}
      </p>
      <div className="mt-2 flex gap-2">
        <button
          onClick={() => retry(tab.id)}
          className="rounded-md bg-sky-600 px-3 py-1.5 text-sm text-white hover:bg-sky-500"
        >
          {tab.state === "closed" ? "重连" : "重试"}
        </button>
        <button
          onClick={() => closeTab(tab.id)}
          className="rounded-md bg-neutral-800 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-700"
        >
          关闭
        </button>
      </div>
    </Center>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#0a0a0a]/85 text-center">
      {children}
    </div>
  );
}
