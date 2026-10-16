import { useCallback, useEffect, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { open as fileDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import CodeMirror from "@uiw/react-codemirror";
import type { FsEntry, Tab } from "../types";
import { useStore } from "../store";

/* ---------- 路径工具 ---------- */

function localJoin(cwd: string, name: string): string {
  return cwd.endsWith("\\") ? cwd + name : cwd + "\\" + name;
}
function localParent(cwd: string): string {
  const trimmed = cwd.replace(/\\$/, "");
  if (/^[A-Za-z]:$/.test(trimmed)) return "";
  const idx = trimmed.lastIndexOf("\\");
  if (idx < 0) return "";
  return trimmed.slice(0, idx + 1);
}
function remoteJoin(cwd: string, name: string): string {
  return cwd === "/" ? "/" + name : cwd + "/" + name;
}
function remoteParent(cwd: string): string {
  if (cwd === "/") return "/";
  const p = cwd.replace(/\/+$/, "");
  const idx = p.lastIndexOf("/");
  return idx <= 0 ? "/" : p.slice(0, idx);
}
function baseName(p: string): string {
  const norm = p.replace(/[\\/]+$/, "");
  const idx = Math.max(norm.lastIndexOf("\\"), norm.lastIndexOf("/"));
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}
function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n;
  let i = -1;
  do {
    v /= 1024;
    i++;
  } while (v >= 1024 && i < units.length - 1);
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}
function fmtTime(t: number | null): string {
  if (!t) return "";
  const d = new Date(t * 1000);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const EDIT_CAP = 2 * 1024 * 1024;
let nextTransferId = 1;

interface EditorState {
  path: string;
  content: string;
  dirty: boolean;
  saving: boolean;
}

interface MenuState {
  x: number;
  y: number;
  pane: "remote" | "local";
  entry: FsEntry;
}

export function FileSidebar({ tab, onClose }: { tab: Tab; onClose: () => void }) {
  const sessionId = tab.session.sessionId;

  const transfers = useStore((s) => s.transfers);
  const startTransfer = useStore((s) => s.startTransfer);
  const progressTransfer = useStore((s) => s.progressTransfer);
  const endTransfer = useStore((s) => s.endTransfer);
  const clearTransfer = useStore((s) => s.clearTransfer);
  const clearFinishedTransfers = useStore((s) => s.clearFinishedTransfers);

  const [pane, setPane] = useState<"remote" | "local">("remote");
  const [localCwd, setLocalCwd] = useState("");
  const [localEntries, setLocalEntries] = useState<FsEntry[]>([]);
  const [localSel, setLocalSel] = useState<FsEntry | null>(null);
  const [remoteCwd, setRemoteCwd] = useState("");
  const [remoteEntries, setRemoteEntries] = useState<FsEntry[]>([]);
  const [remoteSel, setRemoteSel] = useState<FsEntry | null>(null);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);

  const report = (msg: string) => setError(msg);

  const refreshLocal = useCallback(async (cwd: string) => {
    try {
      const [actual, entries] = await invoke<[string, FsEntry[]]>("local_list", { path: cwd });
      setLocalCwd(actual);
      setLocalEntries(entries);
      setLocalSel(null);
    } catch (e) {
      report(String(e));
    }
  }, []);

  const refreshRemote = useCallback(
    async (cwd: string) => {
      try {
        const entries = await invoke<FsEntry[]>("sftp_list", { sessionId, path: cwd });
        setRemoteCwd(cwd);
        setRemoteEntries(entries);
        setRemoteSel(null);
      } catch (e) {
        report(String(e));
      }
    },
    [sessionId],
  );

  useEffect(() => {
    void (async () => {
      try {
        const home = await invoke<string>("local_home");
        await refreshLocal(home);
      } catch (e) {
        report(String(e));
      }
    })();
  }, [refreshLocal]);

  useEffect(() => {
    if (!sessionId) return;
    void (async () => {
      try {
        const home = await invoke<string>("sftp_home", { sessionId });
        await refreshRemote(home);
      } catch (e) {
        report(String(e));
      }
    })();
  }, [sessionId, refreshRemote]);

  /* ---------- 远端操作（显式接收条目，供工具栏与右键菜单共用） ---------- */

  const remoteMkdir = async () => {
    const name = prompt("新文件夹名：");
    if (!name) return;
    try {
      await invoke("sftp_mkdir", { sessionId, path: remoteJoin(remoteCwd, name) });
      await refreshRemote(remoteCwd);
    } catch (e) {
      report(String(e));
    }
  };

  const remoteRename = async (entry: FsEntry) => {
    const name = prompt("重命名为：", entry.name);
    if (!name || name === entry.name) return;
    try {
      await invoke("sftp_rename", {
        sessionId,
        from: remoteJoin(remoteCwd, entry.name),
        to: remoteJoin(remoteCwd, name),
      });
      await refreshRemote(remoteCwd);
    } catch (e) {
      report(String(e));
    }
  };

  const remoteDelete = async (entry: FsEntry) => {
    if (!confirm(`删除远端${entry.is_dir ? "目录（需为空）" : "文件"}「${entry.name}」？`)) return;
    try {
      await invoke("sftp_remove", {
        sessionId,
        path: remoteJoin(remoteCwd, entry.name),
        isDir: entry.is_dir,
      });
      await refreshRemote(remoteCwd);
    } catch (e) {
      report(String(e));
    }
  };

  const upload = async () => {
    const file = await fileDialog({ multiple: false, title: "选择要上传的文件" });
    if (typeof file !== "string") return;
    const name = baseName(file);
    const id = nextTransferId++;
    startTransfer(id, `↑ ${name}`, "up");
    const channel = new Channel<{ t: string; done: number; total: number }>();
    channel.onmessage = (ev) => {
      if (ev.t === "progress") progressTransfer(id, ev.done, ev.total);
      else if (ev.t === "done") endTransfer(id, "done");
      else if (ev.t === "canceled") endTransfer(id, "canceled");
    };
    try {
      await invoke("sftp_upload", {
        sessionId,
        transferId: id,
        localPath: file,
        remotePath: remoteJoin(remoteCwd, name),
        onProgress: channel,
      });
    } catch (e) {
      endTransfer(id, "failed", String(e));
    } finally {
      await refreshRemote(remoteCwd);
    }
  };

  const download = async (entry: FsEntry) => {
    if (entry.is_dir) return;
    const target = await saveDialog({ defaultPath: entry.name });
    if (typeof target !== "string") return;
    const id = nextTransferId++;
    startTransfer(id, `↓ ${entry.name}`, "down");
    const channel = new Channel<{ t: string; done: number; total: number }>();
    channel.onmessage = (ev) => {
      if (ev.t === "progress") progressTransfer(id, ev.done, ev.total);
      else if (ev.t === "done") endTransfer(id, "done");
      else if (ev.t === "canceled") endTransfer(id, "canceled");
    };
    try {
      await invoke("sftp_download", {
        sessionId,
        transferId: id,
        remotePath: remoteJoin(remoteCwd, entry.name),
        localPath: target,
        onProgress: channel,
      });
    } catch (e) {
      endTransfer(id, "failed", String(e));
    }
  };

  const openRemoteEditor = async (entry: FsEntry) => {
    try {
      const content = await invoke<string>("sftp_read_text", {
        sessionId,
        path: remoteJoin(remoteCwd, entry.name),
      });
      setEditor({ path: remoteJoin(remoteCwd, entry.name), content, dirty: false, saving: false });
    } catch (e) {
      report(String(e));
    }
  };

  const saveEditor = async () => {
    if (!editor || editor.saving) return;
    setEditor({ ...editor, saving: true });
    try {
      await invoke("sftp_write_text", { sessionId, path: editor.path, content: editor.content });
      setEditor({ ...editor, dirty: false, saving: false });
    } catch (e) {
      report(String(e));
      setEditor((ed) => (ed ? { ...ed, saving: false } : ed));
    }
  };

  /* ---------- 本地操作 ---------- */

  const localMkdir = async () => {
    const name = prompt("新文件夹名：");
    if (!name) return;
    try {
      await invoke("local_mkdir", { path: localJoin(localCwd, name) });
      await refreshLocal(localCwd);
    } catch (e) {
      report(String(e));
    }
  };

  const localRename = async (entry: FsEntry) => {
    const name = prompt("重命名为：", entry.name);
    if (!name || name === entry.name) return;
    try {
      await invoke("local_rename", {
        from: localJoin(localCwd, entry.name),
        to: localJoin(localCwd, name),
      });
      await refreshLocal(localCwd);
    } catch (e) {
      report(String(e));
    }
  };

  const localDelete = async (entry: FsEntry) => {
    if (!confirm(`删除本地${entry.is_dir ? "空目录" : "文件"}「${entry.name}」？`)) return;
    try {
      await invoke("local_remove", {
        path: localJoin(localCwd, entry.name),
        isDir: entry.is_dir,
      });
      await refreshLocal(localCwd);
    } catch (e) {
      report(String(e));
    }
  };

  /* ---------- 右键菜单 ---------- */

  const openMenu = (ev: React.MouseEvent, entry: FsEntry) => {
    ev.preventDefault();
    if (pane === "remote") setRemoteSel(entry);
    else setLocalSel(entry);
    const W = 160;
    const H = 190;
    setMenu({
      x: Math.min(ev.clientX, window.innerWidth - W - 8),
      y: Math.min(ev.clientY, window.innerHeight - H - 8),
      pane: pane,
      entry,
    });
  };

  const isRemote = pane === "remote";
  const sel = isRemote ? remoteSel : localSel;
  const activeCount = transfers.filter((t) => t.status === "active").length;

  return (
    <div className="flex h-full w-full flex-col border-l border-neutral-800 bg-neutral-950">
      {/* 头部 */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-neutral-800 px-1.5">
        <div className="flex text-xs">
          {(["remote", "local"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPane(p)}
              className={`rounded px-2.5 py-1 transition-colors ${
                pane === p
                  ? "bg-neutral-800 text-sky-300"
                  : "text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200"
              }`}
            >
              {p === "remote" ? `远程 · ${tab.title}` : "本机"}
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          title="收起文件面板"
          className="rounded px-1.5 py-0.5 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
        >
          »
        </button>
      </div>

      {error && (
        <div className="flex items-center justify-between bg-rose-900/40 px-3 py-1 text-xs text-rose-300">
          <span className="truncate select-text">{error}</span>
          <button onClick={() => report("")} className="ml-2 shrink-0">×</button>
        </div>
      )}

      {/* 目录条 + 操作 */}
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-neutral-800 px-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-neutral-500 select-text">
          {isRemote ? remoteCwd || "…" : localCwd === "" ? "此电脑" : localCwd}
        </span>
        <Btn
          onClick={() => void (isRemote ? refreshRemote(remoteParent(remoteCwd)) : refreshLocal(localParent(localCwd)))}
          title="上级"
        >
          ↰
        </Btn>
        <Btn
          onClick={() => void (isRemote ? refreshRemote(remoteCwd) : refreshLocal(localCwd))}
          title="刷新"
        >
          ⟳
        </Btn>
        <Btn onClick={() => void (isRemote ? remoteMkdir() : localMkdir())} title="新建文件夹">
          ＋📁
        </Btn>
        <Btn
          onClick={() => sel && void (isRemote ? remoteRename(sel) : localRename(sel))}
          disabled={!sel}
          title="重命名"
        >
          ✎
        </Btn>
        <Btn
          onClick={() => sel && void (isRemote ? remoteDelete(sel) : localDelete(sel))}
          disabled={!sel}
          title="删除"
        >
          🗑
        </Btn>
        {isRemote && (
          <>
            <Btn onClick={() => void upload()} title="上传文件到当前远程目录">↑ 传</Btn>
            <Btn
              onClick={() => remoteSel && void download(remoteSel)}
              disabled={!remoteSel || remoteSel.is_dir}
              title="下载选中文件"
            >
              ↓ 下载
            </Btn>
          </>
        )}
      </div>

      {/* 文件列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto text-sm">
        {(isRemote ? remoteEntries : localEntries).length === 0 && (
          <p className="p-3 text-xs text-neutral-600">空目录</p>
        )}
        {(isRemote ? remoteEntries : localEntries).map((e) => {
          const active = sel?.name === e.name;
          return (
            <div
              key={e.name}
              onClick={() => (isRemote ? setRemoteSel(e) : setLocalSel(e))}
              onDoubleClick={() => {
                if (isRemote) {
                  if (e.is_dir) void refreshRemote(remoteJoin(remoteCwd, e.name));
                  else if (e.size <= EDIT_CAP) void openRemoteEditor(e);
                } else if (e.is_dir) {
                  void refreshLocal(localJoin(localCwd, e.name));
                }
              }}
              onContextMenu={(ev) => openMenu(ev, e)}
              className={`flex cursor-default items-center gap-2 px-2.5 py-1 ${
                active ? "bg-sky-900/40" : "hover:bg-neutral-800/60"
              }`}
            >
              <span className="shrink-0 text-xs">{e.is_dir ? "📁" : "📄"}</span>
              <span className="min-w-0 flex-1 truncate text-neutral-200">{e.name}</span>
              <span className="shrink-0 font-mono text-[10px] text-neutral-500">
                {e.is_dir ? "—" : humanSize(e.size)}
              </span>
              <span className="hidden shrink-0 font-mono text-[10px] text-neutral-600 xl:inline">
                {fmtTime(e.mtime)}
              </span>
            </div>
          );
        })}
      </div>

      {/* 传输列表 */}
      {transfers.length > 0 && (
        <div className="max-h-44 shrink-0 overflow-y-auto border-t border-neutral-800">
          <div className="flex items-center justify-between bg-neutral-900/60 px-2.5 py-1 text-[11px] text-neutral-500">
            <span>传输{activeCount > 0 ? `（${activeCount} 进行中）` : ""}</span>
            {activeCount < transfers.length && (
              <button onClick={clearFinishedTransfers} className="hover:text-neutral-300">
                清除已完成
              </button>
            )}
          </div>
          {transfers.map((t) => {
            const pct = t.total > 0 ? Math.floor((t.done / t.total) * 100) : 0;
            return (
              <div key={t.id} className="px-2.5 py-1 text-[11px]">
                <div className="flex items-center gap-1.5">
                  <span className={t.direction === "up" ? "text-amber-400" : "text-sky-400"}>
                    {t.direction === "up" ? "↑" : "↓"}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-neutral-300" title={t.label}>
                    {t.label.slice(2)}
                  </span>
                  {t.status === "active" ? (
                    <>
                      <span className="font-mono text-neutral-500">
                        {pct}% · {humanSize(t.done)}/{t.total ? humanSize(t.total) : "?"}
                      </span>
                      <button
                        onClick={() => void invoke("transfer_cancel", { transferId: t.id })}
                        title="取消此传输"
                        className="rounded px-1 text-neutral-500 hover:bg-neutral-800 hover:text-rose-400"
                      >
                        ✕
                      </button>
                    </>
                  ) : (
                    <>
                      <span
                        className={
                          t.status === "done"
                            ? "text-emerald-500"
                            : t.status === "failed"
                              ? "text-rose-400"
                              : "text-neutral-500"
                        }
                        title={t.error}
                      >
                        {t.status === "done"
                          ? "✓ 完成"
                          : t.status === "failed"
                            ? "⚠ 失败"
                            : "已取消"}
                      </span>
                      <button
                        onClick={() => clearTransfer(t.id)}
                        className="rounded px-1 text-neutral-600 hover:bg-neutral-800 hover:text-neutral-300"
                      >
                        ✕
                      </button>
                    </>
                  )}
                </div>
                {t.status === "active" && (
                  <div className="ml-4 mt-0.5 h-0.5 overflow-hidden rounded bg-neutral-800">
                    <div
                      className="h-full bg-sky-500 transition-all"
                      style={{ width: `${pct || 2}%` }}
                    />
                  </div>
                )}
                {t.status === "failed" && t.error && (
                  <p className="ml-4 truncate text-[10px] text-rose-500/80 select-text" title={t.error}>
                    {t.error}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 右键菜单 */}
      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div
            className="fixed z-50 w-40 rounded-md border border-neutral-700 bg-neutral-900 py-1 shadow-xl"
            style={{ left: menu.x, top: menu.y }}
          >
            {menu.pane === "remote" && menu.entry.is_dir && (
              <MenuItem
                onClick={() => {
                  setMenu(null);
                  void refreshRemote(remoteJoin(remoteCwd, menu.entry.name));
                }}
              >
                打开
              </MenuItem>
            )}
            {menu.pane === "remote" && !menu.entry.is_dir && (
              <>
                <MenuItem
                  onClick={() => {
                    setMenu(null);
                    void download(menu.entry);
                  }}
                >
                  ↓ 下载…
                </MenuItem>
                {menu.entry.size <= EDIT_CAP && (
                  <MenuItem
                    onClick={() => {
                      setMenu(null);
                      void openRemoteEditor(menu.entry);
                    }}
                  >
                    ✎ 编辑
                  </MenuItem>
                )}
              </>
            )}
            {menu.pane === "local" && menu.entry.is_dir && (
              <MenuItem
                onClick={() => {
                  setMenu(null);
                  void refreshLocal(localJoin(localCwd, menu.entry.name));
                }}
              >
                打开
              </MenuItem>
            )}
            <MenuItem
              onClick={() => {
                setMenu(null);
                void (menu.pane === "remote" ? remoteRename(menu.entry) : localRename(menu.entry));
              }}
            >
              ✎ 重命名
            </MenuItem>
            <MenuItem
              danger
              onClick={() => {
                setMenu(null);
                void (menu.pane === "remote" ? remoteDelete(menu.entry) : localDelete(menu.entry));
              }}
            >
              🗑 删除
            </MenuItem>
          </div>
        </>
      )}

      {/* 编辑器：全屏覆盖 */}
      {editor && (
        <div className="fixed inset-0 z-40 flex flex-col bg-neutral-950/95 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="truncate font-mono text-xs text-neutral-400 select-text">{editor.path}</span>
            <div className="flex shrink-0 gap-2">
              <button
                onClick={() => void saveEditor()}
                disabled={!editor.dirty || editor.saving}
                className="rounded-md bg-sky-600 px-3 py-1 text-xs text-white hover:bg-sky-500 disabled:opacity-40"
              >
                {editor.saving ? "保存中…" : editor.dirty ? "保存回写" : "已保存"}
              </button>
              <button
                onClick={() => setEditor(null)}
                className="rounded-md bg-neutral-800 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
              >
                关闭
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-neutral-700">
            <CodeMirror
              value={editor.content}
              theme="dark"
              height="100%"
              onChange={(v) => setEditor((ed) => (ed ? { ...ed, content: v, dirty: true } : ed))}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  onClick,
  children,
  danger,
}: {
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`block w-full px-3 py-1.5 text-left text-xs transition-colors ${
        danger ? "text-rose-400 hover:bg-rose-900/40" : "text-neutral-300 hover:bg-neutral-800"
      }`}
    >
      {children}
    </button>
  );
}

function Btn({
  onClick,
  children,
  disabled,
  title,
}: {
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-30"
    >
      {children}
    </button>
  );
}
