import { useEffect, useState } from "react";
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
import appIcon from "./assets/app-icon.png";

export default function App() {
  const loadHosts = useStore((s) => s.loadHosts);
  const loadAiConfig = useStore((s) => s.loadAiConfig);
  const loadTerminalSettings = useStore((s) => s.loadTerminalSettings);
  const loadSecurityStatus = useStore((s) => s.loadSecurityStatus);
  const hosts = useStore((s) => s.hosts);
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const aiPanelOpen = useStore((s) => s.aiPanelOpen);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const hostForm = useStore((s) => s.hostForm);
  const toggleFiles = useStore((s) => s.toggleFiles);

  useEffect(() => {
    void loadHosts();
    void loadAiConfig();
    void loadTerminalSettings();
    void loadSecurityStatus();
  }, [loadHosts, loadAiConfig, loadTerminalSettings, loadSecurityStatus]);

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
    </div>
  );
}

function Welcome({ hasHosts }: { hasHosts: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center text-neutral-600">
      <img src={appIcon} alt="龙鲸X" className="mb-3 h-16 w-16 opacity-90" />
      <p className="text-sm">
        {hasHosts ? "点击左侧主机开始连接" : "在左侧添加你的第一台服务器"}
      </p>
    </div>
  );
}

function StatusBar() {
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const active = tabs.find((t) => t.id === activeTabId);
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
      <span>龙鲸X v0.1.0</span>
    </div>
  );
}
