import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as fileDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { useStore } from "../store";
import type { TerminalSettings } from "../types";
import { AiSpark, ServerIcon, SlidersIcon } from "./icons";

type Page = "appearance" | "hosts" | "ai";

export function SettingsModal() {
  // 由父组件条件挂载（打开时才 mount），初始页由 store 指定
  const settingsPage = useStore((s) => s.settingsPage);
  const closeSettings = useStore((s) => s.closeSettings);
  const [page, setPage] = useState<Page>(settingsPage ?? "appearance");

  const titles: Record<Page, string> = {
    appearance: "终端外观",
    hosts: "节点管理",
    ai: "智能核心",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="flex h-[520px] w-[720px] overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 shadow-xl">
        {/* 左侧导航 */}
        <nav className="flex w-40 shrink-0 flex-col border-r border-neutral-800 bg-neutral-950 p-2">
          <div className="px-2 pt-1 pb-3 text-sm font-semibold text-neutral-200">设置</div>
          {(
            [
              ["appearance", "终端外观", <SlidersIcon key="i" className="h-4 w-4" />],
              ["hosts", "节点管理", <ServerIcon key="i" className="h-4 w-4" />],
              ["ai", "智能核心", <AiSpark key="i" className="h-4 w-4" />],
            ] as const
          ).map(([p, label, icon]) => (
            <button
              key={p}
              onClick={() => setPage(p)}
              className={`mb-1 flex items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                page === p
                  ? "bg-neutral-800 text-sky-300"
                  : "text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200"
              }`}
            >
              {icon}
              {label}
            </button>
          ))}
        </nav>

        {/* 右侧内容 */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-neutral-800 px-4">
            <h2 className="text-sm font-semibold text-neutral-200">{titles[page]}</h2>
            <button
              onClick={closeSettings}
              className="rounded p-1 text-xs text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
            >
              ✕
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {page === "appearance" && <AppearancePane />}
            {page === "hosts" && <HostsPane />}
            {page === "ai" && <AiPane />}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================= 外观 ================= */

function AppearancePane() {
  const saveTerminalSettings = useStore((s) => s.saveTerminalSettings);
  const existing = useStore((s) => s.terminalSettings);

  const [fontSize, setFontSize] = useState(String(existing.fontSize));
  const [cursorBlink, setCursorBlink] = useState(existing.cursorBlink);
  const [scrollback, setScrollback] = useState(String(existing.scrollback));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    const fs = Number(fontSize);
    const sb = Number(scrollback);
    if (!Number.isInteger(fs) || fs < 9 || fs > 28) {
      setError("字体大小需为 9-28 的整数");
      return;
    }
    if (!Number.isInteger(sb) || sb < 100 || sb > 100000) {
      setError("回滚行数需为 100-100000 的整数");
      return;
    }
    const s: TerminalSettings = { fontSize: fs, cursorBlink, scrollback: sb };
    setSaving(true);
    setError("");
    try {
      await saveTerminalSettings(s);
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-md space-y-4">
      <label className="flex items-center justify-between text-sm text-neutral-300">
        <span>终端字体大小</span>
        <input
          type="number"
          min={9}
          max={28}
          value={fontSize}
          onChange={(e) => setFontSize(e.target.value)}
          className="w-24 rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-sm text-neutral-200 outline-none focus:border-sky-500"
        />
      </label>

      <label className="flex items-center justify-between text-sm text-neutral-300">
        <span>光标闪烁</span>
        <input
          type="checkbox"
          checked={cursorBlink}
          onChange={(e) => setCursorBlink(e.target.checked)}
          className="h-4 w-4 accent-sky-600"
        />
      </label>

      <label className="flex items-center justify-between text-sm text-neutral-300">
        <span>回滚行数</span>
        <input
          type="number"
          min={100}
          max={100000}
          step={500}
          value={scrollback}
          onChange={(e) => setScrollback(e.target.value)}
          className="w-24 rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-sm text-neutral-200 outline-none focus:border-sky-500"
        />
      </label>

      <p className="text-[11px] text-neutral-500">保存后立即对所有已打开的终端生效。</p>

      {error && <p className="text-xs text-rose-400">{error}</p>}

      <button
        onClick={() => void submit()}
        disabled={saving}
        className="rounded-md bg-sky-600 px-4 py-1.5 text-sm text-white hover:bg-sky-500 disabled:opacity-50"
      >
        {saving ? "保存中…" : saved ? "✓ 已保存" : "保存"}
      </button>
    </div>
  );
}

/* ================= SSH 主机 ================= */

interface HostGroupMenu {
  x: number;
  y: number;
  project: string;
}

function HostsPane() {
  const hosts = useStore((s) => s.hosts);
  const projects = useStore((s) => s.projects);
  const loadHosts = useStore((s) => s.loadHosts);
  const openHostForm = useStore((s) => s.openHostForm);
  const removeHost = useStore((s) => s.removeHost);
  const createProject = useStore((s) => s.createProject);
  const renameProject = useStore((s) => s.renameProject);
  const deleteProject = useStore((s) => s.deleteProject);

  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<HostGroupMenu | null>(null);

  // 与侧栏一致的分组并集
  const groups = (() => {
    const byProject = new Map<string, typeof hosts>();
    for (const h of hosts) {
      const key = h.project.trim() || "未分组";
      if (!byProject.has(key)) byProject.set(key, []);
      byProject.get(key)!.push(h);
    }
    const keys: string[] = [...projects];
    for (const k of byProject.keys()) {
      if (k !== "未分组" && !keys.includes(k)) keys.push(k);
    }
    keys.sort((a, b) => a.localeCompare(b, "zh-CN"));
    const result: [string, typeof hosts][] = keys
      .filter((k) => byProject.has(k) || projects.includes(k))
      .map((k) => [k, byProject.get(k) ?? []]);
    if (byProject.has("未分组")) result.push(["未分组", byProject.get("未分组")!]);
    return result;
  })();

  const doExport = async () => {
    if (hosts.length === 0) return;
    try {
      const path = await saveDialog({
        defaultPath: "longjing-hosts.json",
        title: "导出主机（含密码，请妥善保管）",
      });
      if (typeof path !== "string") return;
      const n = await invoke<number>("hosts_export", { path });
      alert(`已导出 ${n} 台主机`);
    } catch (e) {
      alert(`导出失败：${e}`);
    }
  };

  const doImport = async () => {
    try {
      const path = await fileDialog({
        multiple: false,
        title: "导入主机 JSON",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (typeof path !== "string") return;
      const n = await invoke<number>("hosts_import", { path });
      await loadHosts();
      alert(n > 0 ? `已导入 ${n} 台主机（重复项已跳过）` : "没有新增主机（全部重复）");
    } catch (e) {
      alert(`导入失败：${e}`);
    }
  };

  const promptCreateProject = async () => {
    const name = prompt("新项目名称：");
    if (!name || !name.trim()) return;
    try {
      await createProject(name.trim());
    } catch (e) {
      alert(String(e));
    }
  };

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <button
          onClick={() => openHostForm(null)}
          className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-sky-500"
        >
          ＋ 添加主机
        </button>
        <button
          onClick={() => void promptCreateProject()}
          className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 transition-colors hover:border-neutral-500 hover:text-neutral-100"
        >
          ＋ 新建项目
        </button>
        <div className="flex-1" />
        <button
          onClick={() => void doImport()}
          className="rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
        >
          导入
        </button>
        <button
          onClick={() => void doExport()}
          disabled={hosts.length === 0}
          className="rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-40"
        >
          导出
        </button>
      </div>

      {groups.length === 0 ? (
        <p className="py-6 text-center text-xs text-neutral-600">还没有主机，点击「添加主机」创建。</p>
      ) : (
        <div className="space-y-3">
          {groups.map(([project, list]) => {
            const isCollapsed = collapsedGroups[project];
            return (
              <div key={project}>
                <button
                  onClick={() => setCollapsedGroups((c) => ({ ...c, [project]: !c[project] }))}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({
                      x: Math.min(e.clientX, window.innerWidth - 170),
                      y: Math.min(e.clientY, window.innerHeight - 120),
                      project,
                    });
                  }}
                  className="mb-1 flex w-full items-center gap-1.5 rounded px-1 py-1 text-left text-xs text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200"
                >
                  <span className={`inline-block transition-transform ${isCollapsed ? "-rotate-90" : ""}`}>▾</span>
                  <span className="flex-1 font-medium">{project}</span>
                  <span className="font-mono text-[10px] text-neutral-600">{list.length}</span>
                </button>
                {!isCollapsed && (
                  <ul className="space-y-1.5">
                    {list.map((h) => (
                      <li
                        key={h.id}
                        className="group flex items-center gap-3 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm text-neutral-200">{h.name}</span>
                            {h.project.trim() && project === "未分组" && (
                              <span className="rounded-full border border-neutral-700 px-1.5 text-[10px] text-neutral-500">
                                {h.project}
                              </span>
                            )}
                          </div>
                          <div className="truncate text-[11px] text-neutral-500">
                            {h.username}@{h.host}:{h.port} · {h.auth_type === "password" ? "密码" : "私钥"}
                          </div>
                        </div>
                        <button
                          onClick={() => openHostForm(h)}
                          className="rounded px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`删除主机「${h.name}」？`)) void removeHost(h.id);
                          }}
                          className="rounded px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-rose-400"
                        >
                          删除
                        </button>
                      </li>
                    ))}
                    {list.length === 0 && (
                      <li className="rounded-md border border-dashed border-neutral-800 px-3 py-2 text-center text-[11px] text-neutral-600">
                        空项目
                      </li>
                    )}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-3 text-[11px] text-neutral-600">
        导出的 JSON 含明文密码，仅用于本机迁移，请妥善保管。右键项目可重命名或删除。
      </p>

      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div
            className="fixed z-50 w-40 rounded-md border border-neutral-700 bg-neutral-900 py-1 shadow-xl"
            style={{ left: menu.x, top: menu.y }}
          >
            {menu.project === "未分组" ? (
              <div className="px-3 py-1.5 text-xs text-neutral-600">系统分组，不可修改</div>
            ) : (
              <>
                <button
                  onClick={() => {
                    const name = prompt("重命名项目为：", menu.project);
                    setMenu(null);
                    if (name && name.trim() && name.trim() !== menu.project) {
                      void renameProject(menu.project, name.trim()).catch((e) => alert(String(e)));
                    }
                  }}
                  className="block w-full px-3 py-1.5 text-left text-xs text-neutral-300 hover:bg-neutral-800"
                >
                  ✎ 重命名
                </button>
                <button
                  onClick={() => {
                    const ok = confirm(
                      `删除项目「${menu.project}」？${hosts.some((h) => h.project === menu.project) ? "项目下的主机将移入「未分组」。" : ""}`,
                    );
                    setMenu(null);
                    if (ok) void deleteProject(menu.project).catch((e) => alert(String(e)));
                  }}
                  className="block w-full px-3 py-1.5 text-left text-xs text-rose-400 hover:bg-rose-900/40"
                >
                  🗑 删除项目
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ================= AI 模型 ================= */

type Backend = "api" | "zcode" | "dsh";

const PRESETS = [
  ["GLM", "https://open.bigmodel.cn/api/paas/v4", "glm-4.7"],
  ["DeepSeek", "https://api.deepseek.com", "deepseek-flash"],
] as const;

const DEFAULT_ZCODE_PATH = ""; // 留空自动探测常见安装位置
const DEFAULT_DSH_PATH = ""; // 留空自动探测常见安装位置

const BACKEND_OPTIONS: { id: Backend; label: string; desc: string }[] = [
  { id: "api", label: "自定义 API", desc: "OpenAI 兼容端点，填 baseURL + API Key" },
  { id: "zcode", label: "ZCode", desc: "复用本机 ZCode 登录。纯问答模式：已禁用其全部工具，执行仍需人工点击" },
  { id: "dsh", label: "DeepSeek (dsh)", desc: "复用本机 DeepSeek Harness 登录，流式输出（含思考过程）" },
];

async function pickPath(
  setter: (v: string) => void,
  opts: { title: string; directory?: boolean },
): Promise<void> {
  const picked = await fileDialog({
    multiple: false,
    directory: opts.directory ?? false,
    title: opts.title,
  });
  if (typeof picked === "string") setter(picked);
}

function AiPane() {
  const saveAiConfig = useStore((s) => s.saveAiConfig);
  const existing = useStore((s) => s.aiConfig);

  const [backend, setBackend] = useState<Backend>(
    (existing?.backend as Backend) || "api",
  );
  const [baseUrl, setBaseUrl] = useState(existing?.base_url ?? "");
  const [apiKey, setApiKey] = useState(existing?.api_key ?? "");
  const [model, setModel] = useState(existing?.model ?? "");
  const [zcodePath, setZcodePath] = useState(
    existing?.zcode_path || DEFAULT_ZCODE_PATH,
  );
  const [zcodeCwd, setZcodeCwd] = useState(existing?.zcode_cwd ?? "");
  const [zcodeMode, setZcodeMode] = useState(existing?.zcode_mode ?? "");
  const [dshPath, setDshPath] = useState(existing?.dsh_path || DEFAULT_DSH_PATH);
  const [models, setModels] = useState<string[] | null>(null);
  const [modelsMsg, setModelsMsg] = useState("");
  const [fetchingModels, setFetchingModels] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function fetchModels() {
    if (!baseUrl.trim() || !apiKey.trim()) {
      setModelsMsg("先填 Base URL 和 API Key");
      return;
    }
    setFetchingModels(true);
    setModelsMsg("");
    try {
      const list = await invoke<string[]>("ai_list_models", {
        config: { base_url: baseUrl.trim(), api_key: apiKey.trim(), model: model.trim() || "-" },
      });
      setModels(list);
      if (model.trim() && !list.includes(model.trim())) {
        setModelsMsg(`当前填写的「${model.trim()}」不在列表里，请核对`);
      }
    } catch (e) {
      setModels(null);
      setModelsMsg(String(e));
    } finally {
      setFetchingModels(false);
    }
  }

  async function submit() {
    const config = {
      backend,
      base_url: baseUrl.trim(),
      api_key: apiKey.trim(),
      model: model.trim(),
      zcode_path: zcodePath.trim(),
      zcode_cwd: zcodeCwd.trim(),
      zcode_mode: zcodeMode.trim(),
      dsh_path: dshPath.trim(),
    };
    if (backend === "api" && (!config.base_url || !config.api_key || !config.model)) {
      setError("自定义 API 需要 Base URL、API Key、模型三项");
      return;
    }
    if (backend === "zcode" && !config.zcode_path) {
      setError("需要填写 zcode.cjs 路径");
      return;
    }
    if (backend === "dsh" && !config.dsh_path) {
      setError("需要填写 dsh.cmd 路径");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await saveAiConfig(config);
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-lg space-y-4">
      {/* 后端选择 */}
      <div className="space-y-2">
        {BACKEND_OPTIONS.map((opt) => (
          <label
            key={opt.id}
            className={`flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 transition-colors ${
              backend === opt.id
                ? "border-sky-600 bg-sky-900/20"
                : "border-neutral-800 hover:border-neutral-600"
            }`}
          >
            <input
              type="radio"
              checked={backend === opt.id}
              onChange={() => setBackend(opt.id)}
              className="mt-0.5 h-3.5 w-3.5 accent-sky-600"
            />
            <span>
              <span className="block text-sm text-neutral-200">{opt.label}</span>
              <span className="block text-[11px] leading-relaxed text-neutral-500">{opt.desc}</span>
            </span>
          </label>
        ))}
      </div>

      {backend === "api" && (
        <>
          <Field label="Base URL">
            <input
              className={inputCls}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.deepseek.com"
            />
          </Field>
          <Field label="API Key">
            <input
              type="password"
              className={inputCls}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-…"
            />
          </Field>
          <Field label="模型">
            <div className="flex gap-2">
              <input
                className={inputCls}
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="deepseek-flash"
              />
              <button
                type="button"
                onClick={() => void fetchModels()}
                disabled={fetchingModels}
                className="shrink-0 rounded-md bg-neutral-800 px-3 text-sm text-neutral-300 transition-colors hover:bg-neutral-700 disabled:opacity-50"
              >
                {fetchingModels ? "获取中…" : "获取模型列表"}
              </button>
            </div>
          </Field>

          {models && models.length > 0 && (
            <div className="max-h-36 overflow-y-auto rounded-md border border-neutral-700 bg-neutral-950 p-1">
              {models.map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    setModel(m);
                    setModelsMsg("");
                  }}
                  className={`block w-full truncate rounded px-2 py-1 text-left font-mono text-xs ${
                    m === model
                      ? "bg-sky-900/50 text-sky-200"
                      : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
          {modelsMsg && <p className="text-xs break-all text-amber-400/90">{modelsMsg}</p>}

          <div className="flex gap-2">
            {PRESETS.map(([name, url, m]) => (
              <button
                key={name}
                onClick={() => {
                  setBaseUrl(url);
                  setModel(m);
                }}
                className="rounded-full border border-neutral-700 px-2.5 py-0.5 text-[11px] text-neutral-400 hover:border-neutral-500 hover:text-neutral-200"
              >
                {name} 预填
              </button>
            ))}
          </div>
        </>
      )}

      {backend === "zcode" && (
        <>
          <Field label="zcode.cjs 路径">
            <div className="flex gap-2">
              <input
                className={`${inputCls} font-mono text-xs`}
                value={zcodePath}
                onChange={(e) => setZcodePath(e.target.value)}
              />
              <button
                type="button"
                onClick={() => void pickPath(setZcodePath, { title: "选择 zcode.cjs" })}
                className="shrink-0 rounded-md bg-neutral-800 px-3 text-sm text-neutral-300 transition-colors hover:bg-neutral-700"
              >
                浏览
              </button>
            </div>
          </Field>
          <Field label="会话工作目录（可选，默认为项目目录）">
            <div className="flex gap-2">
              <input
                className={`${inputCls} font-mono text-xs`}
                value={zcodeCwd}
                onChange={(e) => setZcodeCwd(e.target.value)}
                placeholder="留空 = 龙鲸X 项目目录"
              />
              <button
                type="button"
                onClick={() => void pickPath(setZcodeCwd, { title: "选择会话工作目录", directory: true })}
                className="shrink-0 rounded-md bg-neutral-800 px-3 text-sm text-neutral-300 transition-colors hover:bg-neutral-700"
              >
                浏览
              </button>
            </div>
          </Field>
          <Field label="权限模式">
            <select
              className={inputCls}
              value={zcodeMode}
              onChange={(e) => setZcodeMode(e.target.value)}
            >
              <option value="">ZCode 默认（无头模式为全放权）</option>
              <option value="plan">plan · 只读规划，不执行任何变更</option>
              <option value="guarded">guarded · 危险操作需确认</option>
              <option value="build">build · 可编辑工作区</option>
              <option value="yolo">yolo · 全放权</option>
            </select>
          </Field>
          <p className="text-[11px] leading-relaxed text-neutral-500">
            保留 ZCode 完整代理能力（含本机工具执行），会话历史可在 ZCode TUI 中续接。
            龙鲸X 面板给出的命令仍需人工点击才写入 SSH 终端。回复为一次性返回（非流式）。
          </p>
        </>
      )}

      {backend === "dsh" && (
        <>
          <Field label="dsh.cmd 路径">
            <div className="flex gap-2">
              <input
                className={`${inputCls} font-mono text-xs`}
                value={dshPath}
                onChange={(e) => setDshPath(e.target.value)}
              />
              <button
                type="button"
                onClick={() => void pickPath(setDshPath, { title: "选择 dsh.cmd" })}
                className="shrink-0 rounded-md bg-neutral-800 px-3 text-sm text-neutral-300 transition-colors hover:bg-neutral-700"
              >
                浏览
              </button>
            </div>
          </Field>
          <p className="text-[11px] leading-relaxed text-neutral-500">
            调用本机 DeepSeek Harness 的 headless 档位（纯问答），支持流式输出与思考过程显示。
          </p>
        </>
      )}

      {error && <p className="text-xs text-rose-400">{error}</p>}

      <button
        onClick={() => void submit()}
        disabled={saving}
        className="rounded-md bg-sky-600 px-4 py-1.5 text-sm text-white hover:bg-sky-500 disabled:opacity-50"
      >
        {saving ? "保存中…" : saved ? "✓ 已保存" : "保存"}
      </button>
    </div>
  );
}
const inputCls =
  "w-full rounded-md border border-neutral-700 bg-neutral-800 px-2.5 py-1.5 text-sm text-neutral-200 outline-none focus:border-sky-500";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-neutral-400">{label}</span>
      {children}
    </label>
  );
}
