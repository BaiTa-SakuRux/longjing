import { useEffect, useState } from "react";
import { create } from "zustand";

/* 应用内对话框：替代原生 prompt/confirm/alert。
   WebView2 的原生弹窗标题栏会显示页面来源（开发时是 localhost:1420，打包后是 tauri://localhost），不可定制。 */

export interface DialogOptions {
  title: string;
  message?: string;
  placeholder?: string;
  initialValue?: string;
  okText?: string;
  cancelText?: string;
  /** 确认类对话框的危险操作样式（确定按钮为红色） */
  danger?: boolean;
}

type Pending =
  | { kind: "input"; opts: DialogOptions; resolve: (v: string | null) => void }
  | { kind: "confirm"; opts: DialogOptions; resolve: (v: boolean) => void }
  | { kind: "message"; opts: DialogOptions; resolve: () => void };

interface DialogStore {
  pending: Pending | null;
  open: (p: Pending) => void;
  close: () => void;
}

const useDialogStore = create<DialogStore>((set) => ({
  pending: null,
  open: (pending) => set({ pending }),
  close: () => set({ pending: null }),
}));

/** 文本输入对话框；取消/按 Esc 返回 null（对齐原生 prompt 行为） */
export function askText(opts: DialogOptions): Promise<string | null> {
  return new Promise((resolve) => {
    useDialogStore.getState().open({ kind: "input", opts, resolve });
  });
}

/** 确认对话框；取消/按 Esc 返回 false（对齐原生 confirm 行为） */
export function askConfirm(opts: DialogOptions): Promise<boolean> {
  return new Promise((resolve) => {
    useDialogStore.getState().open({ kind: "confirm", opts, resolve });
  });
}

/** 消息提示对话框（替代 alert） */
export function showMessage(opts: DialogOptions | string): Promise<void> {
  const o = typeof opts === "string" ? { title: "提示", message: opts } : opts;
  return new Promise((resolve) => {
    useDialogStore.getState().open({ kind: "message", opts: o, resolve });
  });
}

/** 挂载一次（App 根组件），承载所有对话框 */
export function AppDialogs() {
  const pending = useDialogStore((s) => s.pending);
  const close = useDialogStore((s) => s.close);
  const [value, setValue] = useState("");

  useEffect(() => {
    if (pending?.kind === "input") setValue(pending.opts.initialValue ?? "");
  }, [pending]);

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      const p = useDialogStore.getState().pending;
      if (!p) return;
      if (p.kind === "input") p.resolve(null);
      else if (p.kind === "confirm") p.resolve(false);
      useDialogStore.getState().close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending]);

  if (!pending) return null;
  const { kind, opts } = pending;

  const finishOk = () => {
    if (kind === "input") pending.resolve(value);
    else if (kind === "confirm") pending.resolve(true);
    close();
  };
  const finishCancel = () => {
    if (kind === "input") pending.resolve(null);
    else if (kind === "confirm") pending.resolve(false);
    close();
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70"
      onMouseDown={finishCancel}
    >
      <div
        className="w-96 rounded-lg border border-neutral-700 bg-neutral-900 p-5 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-sm font-semibold text-neutral-200">{opts.title}</h2>
        {opts.message && (
          <p className="mb-3 max-h-60 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-neutral-400 select-text">
            {opts.message}
          </p>
        )}
        {kind === "input" && (
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                finishOk();
              }
            }}
            placeholder={opts.placeholder}
            autoFocus
            onFocus={(e) => e.target.select()}
            className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-2.5 py-1.5 text-sm text-neutral-200 outline-none focus:border-sky-500"
          />
        )}
        <div className="mt-4 flex justify-end gap-2">
          {kind !== "message" && (
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={finishCancel}
              className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 transition-colors hover:border-neutral-500 hover:text-neutral-100"
            >
              {opts.cancelText ?? "取消"}
            </button>
          )}
          <button
            autoFocus={kind !== "input"}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={finishOk}
            className={`rounded-md px-3 py-1.5 text-xs font-medium text-white transition-colors ${
              kind === "confirm" && opts.danger
                ? "bg-rose-600 hover:bg-rose-500"
                : "bg-sky-600 hover:bg-sky-500"
            }`}
          >
            {opts.okText ?? "确定"}
          </button>
        </div>
      </div>
    </div>
  );
}
