import { useEffect, useRef, useState } from "react";
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
  const duplicateSession = useStore((s) => s.duplicateSession);
  const closeOtherTabs = useStore((s) => s.closeOtherTabs);
  const toggleAiPanel = useStore((s) => s.toggleAiPanel);
  const aiPanelOpen = useStore((s) => s.aiPanelOpen);
  const toggleFiles = useStore((s) => s.toggleFiles);
  const snippets = useStore((s) => s.snippets);
  const loadSnippets = useStore((s) => s.loadSnippets);
  const openSettings = useStore((s) => s.openSettings);
  const activeTab = tabs.find((t) => t.id === activeTabId);

  const [snipOpen, setSnipOpen] = useState(false);
  const [tabMenu, setTabMenu] = useState<{ tabId: number; x: number; y: number } | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (snipOpen) void loadSnippets();
  }, [snipOpen, loadSnippets]);

  // 标签多到溢出时，保证激活标签完整可见（含悬停才显示的关闭按钮）
  useEffect(() => {
    stripRef.current
      ?.querySelector(`[data-tab-id="${activeTabId}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTabId, tabs.length]);

  const sendSnippet = (cmd: string) => {
    if (!activeTab || activeTab.state !== "connected") return;
    activeTab.session.write(new TextEncoder().encode(cmd + "\r"));
  };

  return (
    <div className="flex h-9 shrink-0 items-stretch border-b border-neutral-800 bg-neutral-950">
      <div
        ref={stripRef}
        onWheel={(e) => {
          // 标签条溢出时把竖向滚轮转为横向滚动，否则滚不到最右的标签
          if (e.deltaY !== 0) e.currentTarget.scrollLeft += e.deltaY;
        }}
        className="flex flex-1 items-stretch overflow-x-auto"
      >
        {tabs.length === 0 && (
          <div className="flex items-center px-3 text-xs text-neutral-600">无打开的会话</div>
        )}
        {tabs.map((t) => {
          const st = stateLabel[t.state];
          const active = t.id === activeTabId;
          return (
            <div
              key={t.id}
              data-tab-id={t.id}
              onClick={() => setActive(t.id)}
              onContextMenu={(e) => {
                // 屏蔽 WebView 默认菜单，弹出标签操作菜单
                e.preventDefault();
                setTabMenu({
                  tabId: t.id,
                  x: Math.min(e.clientX, window.innerWidth - 168),
                  y: Math.min(e.clientY + 2, window.innerHeight - 128),
                });
              }}
              title={t.title}
              className={`group flex min-w-20 max-w-48 cursor-pointer items-center gap-2 border-r border-neutral-800 px-3 text-sm ${
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
        <div className="relative flex items-stretch">
          <button
            onClick={() => setSnipOpen((v) => !v)}
            disabled={!activeTab || activeTab.state !== "connected"}
            title="快捷指令：一键发送到当前会话"
            className={`flex items-center gap-1 px-3 text-xs transition-colors ${
              snipOpen
                ? "bg-neutral-900 text-sky-300"
                : "text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200"
            } disabled:opacity-30`}
          >
            ⚡ 指令
          </button>
          {snipOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setSnipOpen(false)} />
              <div className="absolute right-0 top-full z-50 mt-px w-80 rounded-md border border-neutral-700 bg-neutral-900 py-1 shadow-xl">
                {snippets.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-neutral-600">
                    暂无快捷指令，可在设置中创建
                  </p>
                ) : (
                  snippets.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => {
                        sendSnippet(s.command);
                        setSnipOpen(false);
                      }}
                      className="block w-full px-3 py-1.5 text-left hover:bg-neutral-800"
                    >
                      <div className="truncate text-xs text-neutral-200">{s.name}</div>
                      <div className="truncate font-mono text-[10px] text-neutral-500">{s.command}</div>
                    </button>
                  ))
                )}
                <div className="mt-1 border-t border-neutral-800">
                  <button
                    onClick={() => {
                      setSnipOpen(false);
                      openSettings("snippets");
                    }}
                    className="block w-full px-3 py-1.5 text-left text-xs text-neutral-400 hover:bg-neutral-800"
                  >
                    ⚙ 管理快捷指令…
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
        <button
          onClick={() => activeTab && toggleFiles(activeTab.id)}
          disabled={!activeTab || activeTab.state !== "connected"}
          title="文件面板"
          className={`flex items-center gap-1 border-l border-neutral-800 px-3 text-xs transition-colors ${
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

      {/* 标签右键菜单 */}
      {tabMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setTabMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setTabMenu(null);
            }}
          />
          <div
            className="fixed z-50 w-40 rounded-md border border-neutral-700 bg-neutral-900 py-1 shadow-xl"
            style={{ left: tabMenu.x, top: tabMenu.y }}
          >
            <button
              onClick={() => {
                const id = tabMenu.tabId;
                setTabMenu(null);
                duplicateSession(id);
              }}
              className="block w-full px-3 py-1.5 text-left text-xs text-neutral-300 hover:bg-neutral-800"
            >
              ⧉ 复制会话
            </button>
            <button
              onClick={() => {
                const id = tabMenu.tabId;
                setTabMenu(null);
                closeTab(id);
              }}
              className="block w-full px-3 py-1.5 text-left text-xs text-neutral-300 hover:bg-neutral-800"
            >
              ✕ 关闭标签
            </button>
            <button
              onClick={() => {
                const id = tabMenu.tabId;
                setTabMenu(null);
                closeOtherTabs(id);
              }}
              disabled={tabs.length <= 1}
              className="block w-full px-3 py-1.5 text-left text-xs text-neutral-300 hover:bg-neutral-800 disabled:pointer-events-none disabled:opacity-40"
            >
              关闭其他标签
            </button>
          </div>
        </>
      )}
    </div>
  );
}
