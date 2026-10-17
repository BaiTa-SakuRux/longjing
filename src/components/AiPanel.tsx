import { useEffect, useRef, useState } from "react";
import { useStore, type AiMsg } from "../store";
import { AiSpark } from "./icons";

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
  const aiReadTerminal = useStore((s) => s.aiReadTerminal);
  const aiRemoveContextChip = useStore((s) => s.aiRemoveContextChip);

  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
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
    >
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
            title="读取当前终端最近输出作为上下文"
            onClick={aiReadTerminal}
            className="rounded px-1.5 py-0.5 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
          >
            读取终端
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
              <span className="max-w-56 truncate">📎 {c.label}</span>
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
            它建议的命令会以可一键执行的按钮呈现。
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
  const segments = splitSegments(msg.content);

  return (
    <>
      {segments.map((seg, i) =>
        seg.type === "text" ? (
          <span key={i} className="whitespace-pre-wrap">
            {seg.value}
          </span>
        ) : (
          <div key={i} className="my-1.5 overflow-hidden rounded-md border border-neutral-700">
            <div className="flex items-center justify-between bg-neutral-800/80 px-2.5 py-1">
              <span className="font-mono text-[10px] tracking-wide text-neutral-500">SHELL</span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => void navigator.clipboard.writeText(seg.value).catch(() => {})}
                  title="复制命令"
                  className="rounded px-2 py-0.5 text-[11px] text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
                >
                  复制
                </button>
                <button
                  onClick={() => aiExecuteCommand(msg.id, seg.cmdIndex)}
                  disabled={msg.executed.includes(seg.cmdIndex)}
                  className={`rounded px-2 py-0.5 text-[11px] ${
                    msg.executed.includes(seg.cmdIndex)
                      ? "bg-emerald-900/40 text-emerald-400"
                      : "bg-sky-600 text-white hover:bg-sky-500"
                  }`}
                >
                  {msg.executed.includes(seg.cmdIndex) ? "✓ 已写入终端" : "▶ 执行"}
                </button>
              </div>
            </div>
            <pre className="overflow-x-auto bg-neutral-900 px-2.5 py-2 font-mono text-xs text-emerald-300">
              {seg.value}
            </pre>
          </div>
        ),
      )}
    </>
  );
}
