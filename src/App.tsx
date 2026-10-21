import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { useStore } from "./store";
import { HostSidebar } from "./components/HostSidebar";
import { TabBar } from "./components/TabBar";
import { TerminalView } from "./components/TerminalView";
import { HostFormModal } from "./components/HostFormModal";
import { FingerprintModal } from "./components/FingerprintModal";
import { AiPanel } from "./components/AiPanel";
import { FileSidebar } from "./components/FileSidebar";
import { SettingsModal } from "./components/SettingsModal";
import { UnlockModal } from "./components/UnlockModal";
import { AppDialogs } from "./components/dialogs";
import appIcon from "./assets/app-icon.png";

/** 闲置自动锁定：主密码模式下已解锁时，超过设定时长无鼠标/键盘操作即自动锁定 */
function useIdleLock() {
  const masterPassword = useStore((s) => s.masterPassword);
  const securityMasterSet = useStore((s) => s.securityMasterSet);
  const idleLockMinutes = useStore((s) => s.idleLockMinutes);
  const lockNow = useStore((s) => s.lockNow);

  useEffect(() => {
    if (!securityMasterSet || !idleLockMinutes) return;
    let lastActive = Date.now();
    const bump = () => {
      lastActive = Date.now();
    };
    const events = ["mousemove", "mousedown", "keydown", "wheel"] as const;
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const timer = window.setInterval(() => {
      if (masterPassword !== null && Date.now() - lastActive >= idleLockMinutes * 60_000) {
        void lockNow();
      }
    }, 15_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      window.clearInterval(timer);
    };
  }, [securityMasterSet, idleLockMinutes, masterPassword, lockNow]);

  // 手动锁定快捷键：Ctrl+Alt+L（L=Lock，避开常见 Ctrl 单键组合，与系统 Win+L 互不干扰）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        if (securityMasterSet && masterPassword !== null) void lockNow();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [securityMasterSet, masterPassword, lockNow]);
}

/** 全局接管右键菜单：屏蔽 WebView 默认菜单（刷新=重载前端，会清空全部会话并回到锁屏，属事故入口）。
 *  输入框/文本域保留系统菜单供复制粘贴；自定义菜单（标签、主机、AI 路由等）在各自 onContextMenu 里自行弹出。 */
function useNativeContextMenuGuard() {
  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      const editable =
        !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (!editable) e.preventDefault();
    };
    // capture：先于 React 合成事件执行，且不受业务代码 stopPropagation 影响
    window.addEventListener("contextmenu", onCtx, true);
    // F5/Ctrl+R 是 WebView 的刷新快捷键，与菜单同源的事故入口一并屏蔽；
    // 只取消浏览器默认行为，按键事件仍会派发给 xterm（终端里的 Ctrl+R 反向搜索不受影响）
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F5" || (e.ctrlKey && e.key.toLowerCase() === "r")) e.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("contextmenu", onCtx, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);
}

export default function App() {
  const loadHosts = useStore((s) => s.loadHosts);
  const loadAiConfig = useStore((s) => s.loadAiConfig);
  const loadTerminalSettings = useStore((s) => s.loadTerminalSettings);
  const loadSecurityStatus = useStore((s) => s.loadSecurityStatus);
  const loadDangerRules = useStore((s) => s.loadDangerRules);
  const hosts = useStore((s) => s.hosts);
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const aiPanelOpen = useStore((s) => s.aiPanelOpen);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const hostForm = useStore((s) => s.hostForm);
  const toggleFiles = useStore((s) => s.toggleFiles);
  useIdleLock();
  useNativeContextMenuGuard();

  useEffect(() => {
    void loadHosts();
    void loadAiConfig();
    void loadTerminalSettings();
    void loadSecurityStatus();
    void loadDangerRules();
  }, [loadHosts, loadAiConfig, loadTerminalSettings, loadSecurityStatus, loadDangerRules]);

  // 文件侧栏宽度（拖拽分隔条调整）
  const [filesWidth, setFilesWidth] = useState(440);
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const onMove = (ev: MouseEvent) => {
      const w = Math.min(Math.max(window.innerWidth - ev.clientX, 300), window.innerWidth - 460);
      setFilesWidth(w);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  useEffect(() => {
    void loadHosts();
    void loadAiConfig();
  }, [loadHosts, loadAiConfig]);

  return (
    <div className="flex h-screen w-screen bg-neutral-900 text-neutral-200">
      <HostSidebar />

      <main className="flex min-w-0 flex-1 flex-col">
        <TabBar />
        <div className="relative min-h-0 flex-1">
          {tabs.length === 0 ? (
            <Welcome hasHosts={hosts.length > 0} />
          ) : (
            tabs.map((tab) => (
              <div
                key={tab.id}
                className={`absolute inset-0 flex ${tab.id === activeTabId ? "" : "hidden"}`}
              >
                {/* 终端始终挂载：切换文件面板不影响会话与缓冲区 */}
                <div className="min-w-0 flex-1">
                  <TerminalView tab={tab} active={tab.id === activeTabId} />
                </div>
                {tab.filesOpen && tab.state === "connected" && (
                  <>
                    <div
                      className="w-1 shrink-0 cursor-col-resize bg-neutral-800 transition-colors hover:bg-sky-600/60"
                      onMouseDown={startResize}
                    />
                    <div style={{ width: filesWidth }} className="shrink-0">
                      <FileSidebar tab={tab} onClose={() => toggleFiles(tab.id)} />
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>
        <StatusBar />
      </main>

      {aiPanelOpen && <AiPanel />}

      {/* 条件挂载：保证每次打开都从最新 store 状态初始化表单；表单需盖住设置弹窗 */}
      {hostForm && <HostFormModal />}
      <FingerprintModal />
      {settingsOpen && <SettingsModal />}
      <UnlockModal />
      <AppDialogs />
    </div>
  );
}

function Welcome({ hasHosts }: { hasHosts: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center text-neutral-600">
      <img src={appIcon} alt="龙鲸X" className="mb-3 h-16 w-16 opacity-90" />
      <p className="text-sm">
        {hasHosts ? "双击左侧主机开始连接" : "在左侧添加你的第一台服务器"}
      </p>
    </div>
  );
}

function StatusBar() {
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const active = tabs.find((t) => t.id === activeTabId);
  // 版本号动态读自 tauri.conf.json，提版不再改代码
  const [version, setVersion] = useState("");
  useEffect(() => {
    void getVersion()
      .then((v) => setVersion(v ?? ""))
      .catch(() => {});
  }, []);
  const stateText: Record<string, string> = {
    connecting: "连接中",
    connected: "已连接",
    error: "错误",
    closed: "已断开",
  };
  return (
    <div className="flex h-6 shrink-0 items-center justify-between border-t border-neutral-800 bg-neutral-950 px-3 text-[11px] text-neutral-500">
      <span>
        {active
          ? `${active.host.username}@${active.host.host}:${active.host.port} · ${stateText[active.state] ?? active.state}`
          : "就绪"}
      </span>
      <span>龙鲸X{version ? ` v${version}` : ""}</span>
    </div>
  );
}
