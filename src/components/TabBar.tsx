import { useStore } from "../store";
import { AiSpark } from "./icons";

const stateLabel: Record<string, { text: string; cls: string }> = {
  connecting: { text: "●", cls: "text-amber-400" },
  connected: { text: "●", cls: "text-emerald-500" },
  error: { text: "●", cls: "text-rose-500" },
  closed: { text: "○", cls: "text-neutral-500" },
};

export function TabBar() {
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const setActive = useStore((s) => s.setActive);
  const closeTab = useStore((s) => s.closeTab);
  const toggleAiPanel = useStore((s) => s.toggleAiPanel);
  const aiPanelOpen = useStore((s) => s.aiPanelOpen);
  const toggleFiles = useStore((s) => s.toggleFiles);
  const activeTab = tabs.find((t) => t.id === activeTabId);

  return (
    <div className="flex h-9 shrink-0 items-stretch border-b border-neutral-800 bg-neutral-950">
      <div className="flex flex-1 items-stretch overflow-x-auto">
        {tabs.length === 0 && (
          <div className="flex items-center px-3 text-xs text-neutral-600">无打开的会话</div>
        )}
        {tabs.map((t) => {
          const st = stateLabel[t.state];
          const active = t.id === activeTabId;
          return (
            <div
              key={t.id}
              onClick={() => setActive(t.id)}
              className={`group flex min-w-32 max-w-48 cursor-pointer items-center gap-2 border-r border-neutral-800 px-3 text-sm ${
                active
                  ? "bg-neutral-900 text-neutral-100"
                  : "text-neutral-400 hover:bg-neutral-900/60"
              }`}
            >
              <span className={`text-[10px] ${st.cls}`}>{st.text}</span>
              <span className="flex-1 truncate">{t.title}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(t.id);
                }}
                className="rounded px-1 text-xs text-neutral-600 opacity-0 group-hover:opacity-100 hover:text-neutral-200"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
      <div className="flex shrink-0 items-stretch border-l border-neutral-800">
        <button
          onClick={() => activeTab && toggleFiles(activeTab.id)}
          disabled={!activeTab || activeTab.state !== "connected"}
          title="文件面板"
          className={`flex items-center gap-1 px-3 text-xs transition-colors ${
            activeTab?.filesOpen
              ? "bg-neutral-900 text-sky-300"
              : "text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200"
          } disabled:opacity-30`}
        >
          📁 文件
        </button>
        <button
          onClick={toggleAiPanel}
          title="AI 助手（龙鲸X）"
          className={`flex items-center gap-1.5 border-l border-neutral-800 px-3 text-xs transition-colors ${
            aiPanelOpen
              ? "bg-neutral-900 text-sky-300"
              : "text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200"
          }`}
        >
          <AiSpark className="h-3.5 w-3.5" />
          AI
        </button>
      </div>
    </div>
  );
}
