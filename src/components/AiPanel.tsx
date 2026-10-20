import { useEffect, useRef, useState } from "react";
import ReactMarkdown, { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { invoke } from "@tauri-apps/api/core";
import { open as fileDialog } from "@tauri-apps/plugin-dialog";
import { useStore, isDangerousCommand, type AiMsg } from "../store";
import { askConfirm, showMessage } from "./dialogs";
import { AiSpark } from "./icons";

/** AI 文本段的 Markdown 渲染（GFM 表格/标题/列表/行内代码）；``` 代码块不走这里（由 SHELL 卡片承接） */
const mdComponents: Components = {
  h1: (p) => <h1 className="mb-1.5 mt-3 text-base font-semibold text-neutral-100" {...p} />,
  h2: (p) => (
    <h2
      className="mb-1.5 mt-3 border-b border-neutral-800 pb-1 text-sm font-semibold text-neutral-100"
      {...p}
    />
  ),
  h3: (p) => <h3 className="mb-1 mt-2.5 text-sm font-semibold text-neutral-200" {...p} />,
  p: (p) => <p className="my-1.5 leading-relaxed" {...p} />,
  ul: (p) => <ul className="my-1.5 list-disc space-y-1 pl-5" {...p} />,
  ol: (p) => <ol className="my-1.5 list-decimal space-y-1 pl-5" {...p} />,
  li: (p) => <li className="leading-relaxed" {...p} />,
  strong: (p) => <strong className="font-semibold text-neutral-100" {...p} />,
  code: (p) => (
    <code
      className="rounded bg-neutral-800 px-1 py-0.5 font-mono text-xs text-sky-300"
      {...p}
    />
  ),
  pre: (p) => (
    <pre
      className="my-1.5 overflow-x-auto rounded-md bg-neutral-900 p-2.5 font-mono text-xs text-emerald-300"
      {...p}
    />
  ),
  table: (p) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-xs" {...p} />
    </div>
  ),
  th: (p) => (
    <th
      className="border border-neutral-700 bg-neutral-800/80 px-2 py-1 text-left font-medium text-neutral-200"
      {...p}
    />
  ),
  td: (p) => <td className="border border-neutral-700 px-2 py-1 align-top text-neutral-300" {...p} />,
  blockquote: (p) => (
    <blockquote className="my-1.5 border-l-2 border-neutral-700 pl-3 text-neutral-400" {...p} />
  ),
  hr: (p) => <hr className="my-3 border-neutral-800" {...p} />,
  a: (p) => <a target="_blank" rel="noreferrer" className="text-sky-400 underline underline-offset-2" {...p} />,
};

function Md({ children }: { children: string }) {
  return (
    <div className="text-sm leading-relaxed text-neutral-300">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

type Segment = { type: "text"; value: string } | { type: "code"; value: string; cmdIndex: number };

/** 把 markdown 文本按 ``` 代码块切段；cmdIndex 与 extractCommands 的提取顺序一致 */
function splitSegments(content: string): Segment[] {
  const segments: Segment[] = [];
  const re = /```[a-zA-Z0-9_-]*\r?\n([\s\S]*?)```/g;
  let last = 0;
  let cmdIndex = 0;
  for (const m of content.matchAll(re)) {
    const before = content.slice(last, m.index ?? 0);
    if (before.trim()) segments.push({ type: "text", value: before });
    segments.push({ type: "code", value: m[1].replace(/\n$/, ""), cmdIndex });
    last = (m.index ?? 0) + m[0].length;
    cmdIndex++;
  }
  const rest = content.slice(last);
  if (rest.trim()) segments.push({ type: "text", value: rest });
  return segments;
}

export function AiPanel() {
  const aiMessages = useStore((s) => s.aiMessages);
  const aiStreaming = useStore((s) => s.aiStreaming);
  const aiStage = useStore((s) => s.aiStage);
  const aiConfig = useStore((s) => s.aiConfig);
  const backendLabel = (() => {
    const b = aiConfig?.backend || "api";
    if (b === "zcode") return "ZCode";
    if (b === "dsh") return "DeepSeek";
    if (aiConfig?.model) return aiConfig.model;
    return "未配置";
  })();
  const aiContextChips = useStore((s) => s.aiContextChips);
  const toggleAiPanel = useStore((s) => s.toggleAiPanel);
  const openSettings = useStore((s) => s.openSettings);
  const aiSend = useStore((s) => s.aiSend);
  const aiAbort = useStore((s) => s.aiAbort);
  const aiReadTerminals = useStore((s) => s.aiReadTerminals);
  const aiAttachFiles = useStore((s) => s.aiAttachFiles);
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const aiRemoveContextChip = useStore((s) => s.aiRemoveContextChip);
  const aiClearSession = useStore((s) => s.aiClearSession);

  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const aliveTabs = tabs.filter((t) => t.session.alive);
  const [readOpen, setReadOpen] = useState(false);
  const [readSel, setReadSel] = useState<number[] | null>(null);
  const [dropHover, setDropHover] = useState(false);

  const FILE_FILTERS = [
    {
      name: "脚本与文档",
      extensions: [
        "sh", "bash", "zsh", "py", "md", "txt", "yml", "yaml", "toml", "conf",
        "cfg", "ini", "sql", "json", "service", "env", "ps1", "bat", "cmd",
        "properties", "xml", "log", "list",
      ],
    },
  ];

  /** 📎 选择本地脚本/文档 → 读文本 → 文件芯片 */
  const pickAttachments = async () => {
    const picked = await fileDialog({
      multiple: true,
      title: "选择脚本或部署文档",
      filters: FILE_FILTERS,
    });
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    const items: { name: string; text: string }[] = [];
    for (const p of paths) {
      try {
        const t = await invoke<{ content: string; truncated: boolean }>("local_read_text", {
          path: p,
        });
        const name = p.split(/[\\/]/).pop() || p;
        items.push({
          name,
          text: t.truncated ? `${t.content}\n…（超过 200KB 已截断）` : t.content,
        });
      } catch (e) {
        void showMessage({ title: `读取失败：${p.split(/[\\/]/).pop()}`, message: String(e) });
      }
    }
    if (items.length > 0) aiAttachFiles(items);
  };

  /** 拖拽文件到 AI 面板 → 浏览器 File API 直读内容（无需后端） */
  const dropAttachments = async (e: React.DragEvent) => {
    e.preventDefault();
    setDropHover(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    const items: { name: string; text: string }[] = [];
    for (const f of files) {
      if (f.size > 200 * 1024) {
        void showMessage(`「${f.name}」超过 200KB，已跳过`);
        continue;
      }
      const text = await f.text();
      if (text.slice(0, 8192).includes("\0")) {
        void showMessage(`「${f.name}」是二进制文件，已跳过`);
        continue;
      }
      items.push({ name: f.name, text });
    }
    if (items.length > 0) aiAttachFiles(items);
  };
  // 仅当用户本就停在底部时才跟随滚动；翻上去阅读/点中间的执行按钮时不再强制拉到底
  const stickToBottomRef = useRef(true);

  // 新消息/流式输出时跟随滚动
  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [aiMessages]);

  const onListScroll = () => {
    const el = listRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // 面板宽度可拖拽调整（左缘细条）
  const [width, setWidth] = useState(384);
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const onMove = (ev: MouseEvent) => {
      setWidth(Math.min(Math.max(window.innerWidth - ev.clientX, 320), window.innerWidth - 460));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  function send() {
    const text = input;
    setInput("");
    stickToBottomRef.current = true;
    void aiSend(text);
  }

  return (
    <aside
      className="relative flex shrink-0 flex-col border-l border-neutral-800 bg-neutral-950"
      style={{ width }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setDropHover(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropHover(false);
      }}
      onDrop={(e) => void dropAttachments(e)}
    >
      {dropHover && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center border-2 border-dashed border-sky-600 bg-sky-950/50">
          <p className="text-sm text-sky-300">松开以附加脚本 / 部署文档</p>
        </div>
      )}
      <div
        onMouseDown={startResize}
        title="拖拽调整宽度"
        className="absolute left-0 top-0 z-10 h-full w-1 cursor-col-resize transition-colors hover:bg-sky-600/60"
      />
      {/* 头部 */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-neutral-800 px-3">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-sky-300/90">
          <AiSpark className="h-4 w-4" /> 龙鲸X AI
          <span
            title={`当前后端：${backendLabel}`}
            className="ml-1 max-w-40 truncate rounded-full border border-neutral-700 px-1.5 py-0.5 text-[10px] font-normal text-neutral-400"
          >
            {backendLabel}
          </span>
        </span>
        <div className="flex items-center gap-1">
        <button
          title="附加脚本或部署文档（也可直接拖入面板）"
          onClick={() => void pickAttachments()}
          className="rounded px-1.5 py-0.5 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
        >
          📎
        </button>
        <div className="relative">
          <button
            title="读取终端最近输出作为上下文（可多选主机）"
            onClick={() => {
              setReadOpen((v) => {
                const nv = !v;
                if (nv && readSel === null) {
                  const def = aliveTabs.find((t) => t.id === activeTabId) ?? aliveTabs[0];
                  setReadSel(def ? [def.id] : []);
                }
                return nv;
              });
            }}
            className="rounded px-1.5 py-0.5 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
          >
            读取终端
          </button>
          {readOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setReadOpen(false)} />
              <div className="absolute right-0 top-full z-50 mt-px w-64 rounded-md border border-neutral-700 bg-neutral-900 py-2 shadow-xl">
                <p className="px-3 pb-1.5 text-[11px] text-neutral-500">选择要读取的终端：</p>
                {aliveTabs.length === 0 && (
                  <p className="px-3 pb-2 text-xs text-neutral-600">没有已连接的会话</p>
                )}
                {aliveTabs.map((t) => (
                  <label
                    key={t.id}
                    className="flex cursor-pointer items-center gap-2 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
                  >
                    <input
                      type="checkbox"
                      checked={readSel?.includes(t.id) ?? false}
                      onChange={(e) =>
                        setReadSel((s) =>
                          e.target.checked
                            ? [...(s ?? []), t.id]
                            : (s ?? []).filter((i) => i !== t.id),
                        )
                      }
                      className="h-3.5 w-3.5 accent-sky-600"
                    />
                    <span className="truncate">{t.host.name}</span>
                    <span className="ml-auto truncate text-[10px] text-neutral-600">{t.host.host}</span>
                  </label>
                ))}
                <div className="mt-1 border-t border-neutral-800 px-3 pt-1.5">
                  <button
                    onClick={() => {
                      void aiReadTerminals(readSel ?? []);
                      setReadOpen(false);
                    }}
                    disabled={!readSel || readSel.length === 0}
                    className="mb-1 w-full rounded bg-sky-600 px-2 py-1 text-xs text-white hover:bg-sky-500 disabled:opacity-40"
                  >
                    读取所选{readSel?.length ? `（${readSel.length} 台）` : ""}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
          <button
            title="清空会话：移除聊天记录与待执行建议，后端会话重新开始"
            onClick={() => {
              void (async () => {
                const s = useStore.getState();
                if (s.aiMessages.length === 0 && s.aiContextChips.length === 0) return;
                const ok = await askConfirm({
                  title: "清空 AI 会话",
                  message: "将移除聊天记录、上下文芯片与未执行的命令建议，后端会话重新开始。",
                  okText: "清空",
                });
                if (ok) aiClearSession();
              })();
            }}
            className="rounded px-1.5 py-0.5 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
          >
            🧹
          </button>
          <button
            title="AI 设置"
            onClick={() => openSettings("ai")}
            className="rounded px-1.5 py-0.5 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
          >
            ⚙
          </button>
          <button
            title="折叠面板"
            onClick={toggleAiPanel}
            className="rounded px-1.5 py-0.5 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
          >
            »
          </button>
        </div>
      </div>

      {!aiConfig && (
        <button
          onClick={() => openSettings("ai")}
          className="mx-3 mt-2 rounded-md border border-amber-700/50 bg-amber-900/20 px-3 py-2 text-left text-xs text-amber-300 hover:bg-amber-900/30"
        >
          尚未配置 AI（baseURL / apiKey / model），点击设置 →
        </button>
      )}

      {/* 上下文 chips */}
      {aiContextChips.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pt-2">
          {aiContextChips.map((c) => (
            <span
              key={c.id}
              className="flex max-w-full items-center gap-1 rounded-full border border-sky-800 bg-sky-900/30 px-2 py-0.5 text-[11px] text-sky-300"
              title={c.text}
            >
              <span className="max-w-56 truncate">{c.kind === "file" ? "📄" : "📎"} {c.label}</span>
              <button
                onClick={() => aiRemoveContextChip(c.id)}
                className="text-sky-500 hover:text-sky-200"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* 消息列表 */}
      <div
        ref={listRef}
        onScroll={onListScroll}
        className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-3 select-text"
      >
        {aiMessages.length === 0 && (
          <div className="pt-8 text-center text-xs leading-relaxed text-neutral-600">
            向龙鲸X描述你的目标，或先「读取终端」再提问。
            <br />
            也可拖入部署文档 / 脚本，AI 会提炼成可一键执行的命令。
          </div>
        )}
        {aiMessages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="flex justify-end">
              <div className="mr-1 flex flex-col items-end">
                <span className="mb-1 text-[11px] text-neutral-600">你</span>
                <div className="max-w-[85%] rounded-lg rounded-br-sm bg-neutral-800 px-3 py-2 text-sm whitespace-pre-wrap text-neutral-200">
                  {m.content}
                </div>
              </div>
            </div>
          ) : (
            <div key={m.id}>
              <div className="mb-1 flex items-center gap-1.5 pl-0.5">
                <AiSpark className="h-3.5 w-3.5 text-sky-400" />
                <span className="text-[11px] font-medium text-sky-300/80">龙鲸X</span>
              </div>
              <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2.5 text-sm leading-relaxed text-neutral-300">
                <MessageBody msg={m} />
                {aiStreaming && m.id === aiMessages[aiMessages.length - 1]?.id && (
                  <>
                    <span className="ml-0.5 inline-block h-3.5 w-2 animate-pulse bg-neutral-400 align-text-bottom" />
                    {aiStage && (
                      <span className="ml-2 animate-pulse text-[11px] text-neutral-500">{aiStage}…</span>
                    )}
                  </>
                )}
              </div>
            </div>
          ),
        )}
      </div>

      {/* 输入区 */}
      <div className="shrink-0 border-t border-neutral-800 p-2.5">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          rows={3}
          placeholder="描述问题或目标…（Enter 发送，Shift+Enter 换行）"
          className="w-full resize-none rounded-md border border-neutral-700 bg-neutral-900 px-2.5 py-2 text-sm text-neutral-200 outline-none focus:border-sky-500"
        />
        <div className="mt-1.5 flex justify-end gap-2">
          {aiStreaming ? (
            <button
              onClick={() => void aiAbort()}
              className="rounded-md bg-rose-600 px-3 py-1.5 text-sm text-white hover:bg-rose-500"
            >
              中止
            </button>
          ) : (
            <button
              onClick={send}
              disabled={!input.trim()}
              className="rounded-md bg-sky-600 px-3 py-1.5 text-sm text-white hover:bg-sky-500 disabled:opacity-40"
            >
              发送
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}

function MessageBody({ msg }: { msg: AiMsg }) {
  const aiExecuteCommand = useStore((s) => s.aiExecuteCommand);
  const editAiCommand = useStore((s) => s.editAiCommand);
  const tabs = useStore((s) => s.tabs);
  const [routes, setRoutes] = useState<Record<number, string>>({});
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [popPos, setPopPos] = useState<{ top: number; left: number } | null>(null);
  // 命令编辑模式：editIdx = 正在编辑的命令下标，editBuf = 编辑缓冲
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editBuf, setEditBuf] = useState("");
  const aliveTabs = tabs.filter((t) => t.session.alive);
  const segments = splitSegments(msg.content);

  const selNames = (idx: number): string[] => routes[idx]?.split(",").filter(Boolean) ?? [];
  // 目标按钮短语：紧凑显示，避免长 IP 列表撑爆命令块头部
  const routeBtnLabel = (idx: number): string => {
    const names = selNames(idx);
    if (names.length === 0) {
      const auto = msg.commands[idx]?.hostTag;
      return auto ? `→ ${auto}` : "自动";
    }
    if (names.length === aliveTabs.length && aliveTabs.length > 0) return `全部 ${names.length} 台`;
    if (names.length === 1) return `→ ${names[0]}`;
    return `已选 ${names.length} 台`;
  };
  // 执行按钮 tooltip：完整路由明细
  const routeDetail = (idx: number): string => {
    const names = selNames(idx);
    const auto = msg.commands[idx]?.hostTag;
    const eff = names.length ? names : auto ? [auto] : [];
    if (eff.length === 0) return "当前激活标签";
    if (eff.length === aliveTabs.length && aliveTabs.length > 0) {
      return `全部 ${eff.length} 台已连接主机`;
    }
    return eff.join("、");
  };
  // 🎯 弹层用 fixed 定位：命令卡片容器 overflow-hidden 会裁剪 absolute 弹层——窄面板时左端
  // （复选框/IP 前缀）被剪掉，矮命令块时底部（全选/清空）被剪掉。按按钮视口坐标浮动并钳制在窗口内。
  const openRoutePop = (cmdIndex: number, el: HTMLButtonElement) => {
    if (openIdx === cmdIndex) {
      setOpenIdx(null);
      return;
    }
    const r = el.getBoundingClientRect();
    const h = 62 + Math.max(aliveTabs.length, 1) * 26 + 36; // 标题+主机行+底部按钮，估算高度
    const left = Math.min(Math.max(r.right - 224, 8), window.innerWidth - 232);
    const top = r.bottom + 4 + h > window.innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4;
    setPopPos({ top, left });
    setOpenIdx(cmdIndex);
  };

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === "text") return <Md key={i}>{seg.value}</Md>;
        const danger = isDangerousCommand(seg.value);
        return (
          <div
            key={i}
            className={`my-1.5 overflow-hidden rounded-md border ${
              danger ? "border-rose-600/80 ring-1 ring-rose-900/70" : "border-neutral-700"
            }`}
          >
            <div
              className={`relative flex items-center justify-between gap-1 px-2.5 py-1 ${
                danger ? "bg-rose-950/70" : "bg-neutral-800/80"
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className={`font-mono text-[10px] tracking-wide ${danger ? "text-rose-400" : "text-neutral-500"}`}>SHELL</span>
                {danger && (
                  <span
                    title="命中高危规则（删除/磁盘/重启等），执行前会弹二次确认"
                    className="rounded bg-rose-800 px-1.5 py-0.5 text-[10px] font-medium text-rose-100"
                  >
                    ⚠ 高危
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <div className="relative">
                  <button
                    onClick={(e) => openRoutePop(seg.cmdIndex, e.currentTarget)}
                    title="目标主机（可多选；不选 = 自动）"
                    className={`max-w-32 truncate rounded px-1.5 py-0.5 text-[10px] transition-colors ${
                      selNames(seg.cmdIndex).length
                        ? "bg-sky-900/60 text-sky-300"
                        : "bg-neutral-700 text-neutral-300 hover:bg-neutral-600"
                    }`}
                  >
                    🎯 {routeBtnLabel(seg.cmdIndex)}
                  </button>
                  {openIdx === seg.cmdIndex && popPos && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setOpenIdx(null)} />
                      <div
                        style={{ top: popPos.top, left: popPos.left }}
                        className="fixed z-50 w-56 rounded-md border border-neutral-700 bg-neutral-900 py-2 shadow-xl"
                      >
                        <p className="px-3 pb-1.5 text-[11px] text-neutral-500">
                          目标主机（可多选；不选 = 自动）
                        </p>
                        {aliveTabs.length === 0 && (
                          <p className="px-3 pb-2 text-xs text-neutral-600">没有已连接的会话</p>
                        )}
                        {aliveTabs.map((t) => (
                          <label
                            key={t.id}
                            className="flex cursor-pointer items-center gap-2 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
                          >
                            <input
                              type="checkbox"
                              checked={selNames(seg.cmdIndex).includes(t.host.name)}
                              onChange={(e) => {
                                const cur = selNames(seg.cmdIndex);
                                const next = e.target.checked
                                  ? [...cur, t.host.name]
                                  : cur.filter((n) => n !== t.host.name);
                                setRoutes({ ...routes, [seg.cmdIndex]: next.join(",") });
                              }}
                              className="h-3.5 w-3.5 accent-sky-600"
                            />
                            <span className="truncate">{t.host.name}</span>
                            <span className="ml-auto truncate text-[10px] text-neutral-600">
                              {t.host.host}
                            </span>
                          </label>
                        ))}
                        <div className="mt-1 flex gap-1 border-t border-neutral-800 px-3 pt-1.5">
                          <button
                            onClick={() =>
                              setRoutes({
                                ...routes,
                                [seg.cmdIndex]: aliveTabs.map((t) => t.host.name).join(","),
                              })
                            }
                            className="flex-1 rounded bg-neutral-800 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-700"
                          >
                            全选
                          </button>
                          <button
                            onClick={() => setRoutes({ ...routes, [seg.cmdIndex]: "" })}
                            className="flex-1 rounded bg-neutral-800 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-700"
                          >
                            清空
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
                <button
                  onClick={() => {
                    setEditIdx(seg.cmdIndex);
                    setEditBuf(seg.value);
                  }}
                  disabled={msg.executed.includes(seg.cmdIndex)}
                  title="编辑命令（修改路径、参数后再执行）"
                  className="shrink-0 whitespace-nowrap rounded px-2 py-0.5 text-[11px] text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200 disabled:opacity-30"
                >
                  ✎
                </button>
                <button
                  onClick={() => void navigator.clipboard.writeText(seg.value).catch(() => {})}
                  disabled={editIdx === seg.cmdIndex}
                  title="复制命令"
                  className="shrink-0 whitespace-nowrap rounded px-2 py-0.5 text-[11px] text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200 disabled:opacity-30"
                >
                  复制
                </button>
                <button
                  onClick={() =>
                    aiExecuteCommand(msg.id, seg.cmdIndex, routes[seg.cmdIndex] || undefined)
                  }
                  disabled={msg.executed.includes(seg.cmdIndex) || editIdx === seg.cmdIndex}
                  title={`发送到：${routeDetail(seg.cmdIndex)}`}
                  className={`shrink-0 whitespace-nowrap rounded px-2 py-0.5 text-[11px] ${
                    msg.executed.includes(seg.cmdIndex)
                      ? "bg-emerald-900/40 text-emerald-400"
                      : "bg-sky-600 text-white hover:bg-sky-500"
                  }`}
                >
                  {msg.executed.includes(seg.cmdIndex) ? "✓ 已执行" : "▶ 执行"}
                </button>
              </div>
            </div>
            {editIdx === seg.cmdIndex ? (
              <div className={`px-2 py-2 ${danger ? "bg-rose-950/40" : "bg-neutral-900"}`}>
                <textarea
                  value={editBuf}
                  onChange={(e) => setEditBuf(e.target.value)}
                  rows={Math.max(3, editBuf.split("\n").length + 1)}
                  autoFocus
                  className={`w-full resize-y rounded border bg-neutral-950 px-2 py-1.5 font-mono text-xs outline-none ${
                    isDangerousCommand(editBuf)
                      ? "border-rose-500 text-rose-300 focus:border-rose-400"
                      : "border-sky-700 text-emerald-300 focus:border-sky-500"
                  }`}
                />
                <div className="mt-1 flex justify-end gap-1.5">
                  <button
                    onClick={() => setEditIdx(null)}
                    className="rounded bg-neutral-800 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-700"
                  >
                    取消
                  </button>
                  <button
                    onClick={() => {
                      const next = editBuf.replace(/\s+$/, "");
                      if (!next.trim()) return;
                      editAiCommand(msg.id, seg.cmdIndex, next);
                      setEditIdx(null);
                    }}
                    className="rounded bg-sky-600 px-2 py-1 text-[11px] text-white hover:bg-sky-500"
                  >
                    保存
                  </button>
                </div>
              </div>
            ) : (
              <pre
                className={`overflow-x-auto px-2.5 py-2 font-mono text-xs ${
                  danger ? "bg-rose-950/50 text-rose-300" : "bg-neutral-900 text-emerald-300"
                }`}
              >
                {seg.value}
              </pre>
            )}
          </div>
        );
      })}
    </>
  );
}
