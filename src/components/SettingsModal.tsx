import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as fileDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { useStore, DEFAULT_PROJECT_NAME } from "../store";
import { buildProjectTree, type ProjectNode } from "../projects";
import type { Host, TerminalSettings } from "../types";
import { AiSpark, BoltIcon, ServerIcon, ShieldIcon, SlidersIcon } from "./icons";
import { askConfirm, askText, showMessage } from "./dialogs";
import { BatchAddModal } from "./BatchAddModal";

type Page = "appearance" | "hosts" | "snippets" | "ai" | "security" | "danger";

export function SettingsModal() {
  // 由父组件条件挂载（打开时才 mount），初始页由 store 指定
  const settingsPage = useStore((s) => s.settingsPage);
  const closeSettings = useStore((s) => s.closeSettings);
  const [page, setPage] = useState<Page>(settingsPage ?? "appearance");

  const titles: Record<Page, string> = {
    appearance: "终端设置",
    hosts: "节点管理",
    snippets: "快捷指令",
    ai: "智能核心",
    security: "隐私加密",
    danger: "高危命令",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="flex h-[520px] w-[720px] overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 shadow-xl">
        {/* 左侧导航 */}
        <nav className="flex w-40 shrink-0 flex-col border-r border-neutral-800 bg-neutral-950 p-2">
          <div className="px-2 pt-1 pb-3 text-sm font-semibold text-neutral-200">设置</div>
          {(
            [
              ["appearance", "终端设置", <SlidersIcon key="i" className="h-4 w-4" />],
              ["hosts", "节点管理", <ServerIcon key="i" className="h-4 w-4" />],
              ["snippets", "快捷指令", <BoltIcon key="i" className="h-4 w-4" />],
              ["ai", "智能核心", <AiSpark key="i" className="h-4 w-4" />],
              ["security", "隐私加密", <ShieldIcon key="i" className="h-4 w-4" />],
              ["danger", "高危命令", <span key="i">⚠️</span>],
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
            {page === "snippets" && <SnippetsPane />}
            {page === "ai" && <AiPane />}
            {page === "security" && <SecurityPane />}
            {page === "danger" && <DangerPane />}
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
  const [quickPaste, setQuickPaste] = useState(existing.quickPaste !== false);
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
    const s: TerminalSettings = { fontSize: fs, cursorBlink, scrollback: sb, quickPaste };
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

      <label className="flex items-center justify-between text-sm text-neutral-300">
        <span>
          快捷粘贴
          <span className="block text-[11px] text-neutral-600">选中即复制、右键直接粘贴；关闭则恢复默认右键菜单</span>
        </span>
        <input
          type="checkbox"
          checked={quickPaste}
          onChange={(e) => setQuickPaste(e.target.checked)}
          className="h-4 w-4 accent-sky-600"
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

/** 右键菜单目标；node = null 表示「默认项目」（系统分组） */
interface HostGroupMenu {
  x: number;
  y: number;
  node: ProjectNode | null;
}

function HostsPane() {
  const hosts = useStore((s) => s.hosts);
  const projects = useStore((s) => s.projects);
  const loadHosts = useStore((s) => s.loadHosts);
  const openHostForm = useStore((s) => s.openHostForm);
  const removeHost = useStore((s) => s.removeHost);
  const duplicateHost = useStore((s) => s.duplicateHost);
  const createProject = useStore((s) => s.createProject);
  const renameProject = useStore((s) => s.renameProject);
  const deleteProject = useStore((s) => s.deleteProject);

  const [collapsedGroups, setCollapsedGroups] = useState<Record<number, boolean>>({});
  const [menu, setMenu] = useState<HostGroupMenu | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);

  // 项目树 + 按项目名索引主机；默认项目（空串）单独一组，排在最前（与侧栏口径一致）
  const tree = buildProjectTree(projects);
  const byProject = new Map<string, Host[]>();
  for (const h of hosts) {
    const key = h.project.trim();
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key)!.push(h);
  }
  const hostsOf = (node: ProjectNode) => byProject.get(node.name) ?? [];
  const defaultHosts = byProject.get("") ?? [];

  const doExport = async () => {
    if (hosts.length === 0) return;
    try {
      const path = await saveDialog({
        defaultPath: "longjing-hosts.json",
        title: "导出主机（含密码，请妥善保管）",
      });
      if (typeof path !== "string") return;
      const n = await invoke<number>("hosts_export", { path });
      void showMessage(`已导出 ${n} 台主机`);
    } catch (e) {
      void showMessage({ title: "导出失败", message: String(e) });
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
      void showMessage(n > 0 ? `已导入 ${n} 台主机（重复项已跳过）` : "没有新增主机（全部重复）");
    } catch (e) {
      void showMessage({ title: "导入失败", message: String(e) });
    }
  };

  const promptCreateProject = async () => {
    const name = await askText({ title: "新建项目", placeholder: "项目名称" });
    if (!name || !name.trim()) return;
    try {
      await createProject(name.trim());
    } catch (e) {
      void showMessage({ title: "新建项目失败", message: String(e) });
    }
  };

  /** 主机行（项目节点与默认项目组共用） */
  const renderHostRow = (h: Host, badge?: string) => (
    <li
      key={h.id}
      className="group flex items-center gap-3 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm text-neutral-200">{h.name}</span>
          {badge && (
            <span className="rounded-full border border-neutral-700 px-1.5 text-[10px] text-neutral-500">
              {badge}
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
        onClick={() => void duplicateHost(h.id)}
        className="rounded px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
      >
        复制
      </button>
      <button
        onClick={() => {
          void (async () => {
            const ok = await askConfirm({
              title: "删除主机",
              message: `确定删除「${h.name}」？`,
              okText: "删除",
              danger: true,
            });
            if (ok) void removeHost(h.id);
          })();
        }}
        className="rounded px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-rose-400"
      >
        删除
      </button>
    </li>
  );

  /** 递归渲染一个项目节点：标题行 + 直属主机 + 子项目 */
  const renderGroup = (node: ProjectNode) => {
    const list = hostsOf(node);
    const isCollapsed = collapsedGroups[node.id];
    return (
      <div key={node.id}>
        <button
          onClick={() => setCollapsedGroups((c) => ({ ...c, [node.id]: !c[node.id] }))}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({
              x: Math.min(e.clientX, window.innerWidth - 170),
              y: Math.min(e.clientY, window.innerHeight - 150),
              node,
            });
          }}
          style={{ paddingLeft: 4 + node.depth * 14 }}
          className="mb-1 flex w-full items-center gap-1.5 rounded pr-1 py-1 text-left text-xs text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200"
        >
          <span className={`inline-block transition-transform ${isCollapsed ? "-rotate-90" : ""}`}>▾</span>
          <span className="flex-1 truncate font-medium" title={node.pathLabel}>
            {node.name}
          </span>
          <span className="font-mono text-[10px] text-neutral-600">{list.length}</span>
        </button>
        {!isCollapsed && (
          <>
            <ul className="space-y-1.5" style={{ marginLeft: node.depth * 14 }}>
              {list.map((h) => renderHostRow(h))}
              {list.length === 0 && node.children.length === 0 && (
                <li className="rounded-md border border-dashed border-neutral-800 px-3 py-2 text-center text-[11px] text-neutral-600">
                  空项目
                </li>
              )}
            </ul>
            {node.children.map((child) => renderGroup(child))}
          </>
        )}
      </div>
    );
  };

  /** 默认项目组（系统分组，不属于树；仅存在此类主机时显示） */
  const defaultGroup =
    defaultHosts.length > 0 ? (
      <div key={0}>
        <button
          onClick={() => setCollapsedGroups((c) => ({ ...c, [0]: !c[0] }))}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({
              x: Math.min(e.clientX, window.innerWidth - 170),
              y: Math.min(e.clientY, window.innerHeight - 150),
              node: null,
            });
          }}
          className="mb-1 flex w-full items-center gap-1.5 rounded px-1 py-1 text-left text-xs text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200"
        >
          <span className={`inline-block transition-transform ${collapsedGroups[0] ? "-rotate-90" : ""}`}>▾</span>
          <span className="flex-1 font-medium">{DEFAULT_PROJECT_NAME}</span>
          <span className="font-mono text-[10px] text-neutral-600">{defaultHosts.length}</span>
        </button>
        {!collapsedGroups[0] && (
          <ul className="space-y-1.5">
            {defaultHosts.map((h) =>
              renderHostRow(h, h.project.trim() || undefined),
            )}
          </ul>
        )}
      </div>
    ) : null;

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
          onClick={() => setBatchOpen(true)}
          className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 transition-colors hover:border-neutral-500 hover:text-neutral-100"
        >
          批量添加
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

      {tree.length === 0 && defaultHosts.length === 0 ? (
        <p className="py-6 text-center text-xs text-neutral-600">还没有主机，点击「添加主机」创建。</p>
      ) : (
        <div className="space-y-3">
          {defaultGroup}
          {tree.map(renderGroup)}
        </div>
      )}
      <p className="mt-3 text-[11px] text-neutral-600">
        导出的 JSON 中密码为本机加密后的密文，仅供本机备份，其他设备无法解密。右键项目可重命名、新建子项目或删除。
      </p>
      <p className="mt-3 text-[11px] text-neutral-600">
        导出的 JSON 中密码为本机加密后的密文，仅供本机备份，其他设备无法解密。右键项目可重命名或删除。
      </p>

      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div
            className="fixed z-50 w-40 rounded-md border border-neutral-700 bg-neutral-900 py-1 shadow-xl"
            style={{ left: menu.x, top: menu.y }}
          >
            {menu.node === null ? (
              <div className="px-3 py-1.5 text-xs text-neutral-600">系统分组，不可修改</div>
            ) : (
              <>
                <button
                  onClick={() => {
                    setMenu(null);
                    void (async () => {
                      const name = await askText({ title: "重命名项目", initialValue: menu.node!.name });
                      if (!name || !name.trim() || name.trim() === menu.node!.name) return;
                      try {
                        await renameProject(menu.node!.name, name.trim());
                      } catch (e) {
                        void showMessage({ title: "重命名失败", message: String(e) });
                      }
                    })();
                  }}
                  className="block w-full px-3 py-1.5 text-left text-xs text-neutral-300 hover:bg-neutral-800"
                >
                  ✎ 重命名
                </button>
                <button
                  onClick={() => {
                    setMenu(null);
                    void (async () => {
                      const name = await askText({ title: `在「${menu.node!.name}」下新建子项目`, placeholder: "子项目名称" });
                      if (!name || !name.trim()) return;
                      try {
                        await createProject(name.trim(), menu.node!.id);
                      } catch (e) {
                        void showMessage({ title: "新建子项目失败", message: String(e) });
                      }
                    })();
                  }}
                  className="block w-full px-3 py-1.5 text-left text-xs text-neutral-300 hover:bg-neutral-800"
                >
                  📁 新建子项目
                </button>
                <button
                  onClick={() => {
                    setMenu(null);
                    void (async () => {
                      const ok = await askConfirm({
                        title: "删除项目",
                        message: `删除项目「${menu.node!.name}」？${hosts.some((h) => h.project === menu.node!.name) ? `项目下的主机将移入「${DEFAULT_PROJECT_NAME}」。` : ""}`,
                        okText: "删除",
                        danger: true,
                      });
                      if (!ok) return;
                      try {
                        await deleteProject(menu.node!.name);
                      } catch (e) {
                        void showMessage({ title: "删除失败", message: String(e) });
                      }
                    })();
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
      {batchOpen && <BatchAddModal onClose={() => setBatchOpen(false)} />}
    </div>
  );
}

/* ================= 高危命令 ================= */

const BUILTIN_DANGER_LABELS = [
  "rm（所有删除，含 rm -v / 无参数）",
  "truncate（清空文件/表）",
  "mkfs / dd / fdisk / parted（磁盘）",
  "> /dev/sd*（裸设备写入）",
  "shutdown / reboot / init 0|6",
  "iptables --flush / nft flush",
  "kill / pkill / killall / fuser",
  "drop database / truncate table",
  "chmod -R 000",
  "userdel / groupdel",
];

function DangerPane() {
  const dangerRules = useStore((s) => s.dangerRules);
  const saveDangerRules = useStore((s) => s.saveDangerRules);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);

  const add = async () => {
    const v = input.trim();
    if (!v) return;
    if (dangerRules.some((r) => r.toLowerCase() === v.toLowerCase())) {
      void showMessage("该规则已存在");
      return;
    }
    setSaving(true);
    try {
      await saveDangerRules([...dangerRules, v]);
      setInput("");
    } catch (e) {
      void showMessage({ title: "保存失败", message: String(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 text-sm">
      <p className="text-xs leading-relaxed text-neutral-500">
        命中高危规则的命令在 AI 面板中整卡红色高亮并带 ⚠ 徽标，点击执行时弹出带免责声明的二次确认。对所有来源的命令生效（AI 生成、文档提炼等）。
      </p>

      <div>
        <p className="mb-1.5 text-xs text-neutral-400">内置规则（固定生效）</p>
        <div className="flex flex-wrap gap-1.5">
          {BUILTIN_DANGER_LABELS.map((t) => (
            <span
              key={t}
              className="rounded-full border border-rose-900/70 bg-rose-950/40 px-2 py-0.5 text-[11px] text-rose-300"
            >
              {t}
            </span>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-xs text-neutral-400">自定义规则（命令包含片段即命中，不区分大小写）</p>
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void add();
            }}
            placeholder="如：docker rm、drop table、kubectl delete"
            className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-800 px-2.5 py-1.5 text-sm text-neutral-200 outline-none focus:border-sky-500"
          />
          <button
            onClick={() => void add()}
            disabled={saving || !input.trim()}
            className="rounded-md bg-sky-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-sky-500 disabled:opacity-40"
          >
            添加
          </button>
        </div>
        <div className="mt-2 space-y-1.5">
          {dangerRules.length === 0 && (
            <p className="rounded-md border border-dashed border-neutral-800 px-3 py-2 text-center text-[11px] text-neutral-600">
              暂无自定义规则
            </p>
          )}
          {dangerRules.map((r) => (
            <div
              key={r}
              className="flex items-center gap-2 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-1.5"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-rose-300">{r}</span>
              <button
                onClick={() => void saveDangerRules(dangerRules.filter((x) => x !== r))}
                className="rounded px-2 py-0.5 text-xs text-neutral-500 hover:bg-neutral-800 hover:text-rose-400"
              >
                删除
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2.5">
        <p className="mb-1 text-xs font-medium text-neutral-400">⚠️ 免责声明</p>
        <p className="text-[11px] leading-relaxed text-neutral-500">
          高危命令可能造成不可逆影响（数据删除、服务中断、设备重启等）。龙鲸X
          仅提供执行前的确认提醒，不校验命令正确性与环境适配性；命令写入终端并执行后的全部结果，由操作者自行承担。
        </p>
      </div>
    </div>
  );
}

/* ================= AI 模型 ================= */

type Backend = "api" | "zcode" | "dsh";

const PRESETS = [
  ["GLM", "https://open.bigmodel.cn/api/paas/v4", "glm-4.7"],
  ["DeepSeek", "https://api.deepseek.com", "deepseek-flash"],
] as const;

const DEFAULT_ZCODE_PATH = "D:/byxhw/INSTALL/ZCode/resources/glm/zcode.cjs";
const DEFAULT_DSH_PATH =
  "C:/Users/byxhw/AppData/Local/Programs/DeepSeek Harness/resources/runtime/cli/bin/dsh.cmd";

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
  const [dshCwd, setDshCwd] = useState(existing?.dsh_cwd ?? "");
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
      dsh_cwd: dshCwd.trim(),
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
          <Field label="会话工作目录（可选，默认为龙鲸X 数据目录）">
            <div className="flex gap-2">
              <input
                className={`${inputCls} font-mono text-xs`}
                value={zcodeCwd}
                onChange={(e) => setZcodeCwd(e.target.value)}
                placeholder="留空 = 龙鲸X 数据目录"
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
          <Field label="会话工作目录（可选，默认为龙鲸X 数据目录）">
            <div className="flex gap-2">
              <input
                className={`${inputCls} font-mono text-xs`}
                value={dshCwd}
                onChange={(e) => setDshCwd(e.target.value)}
                placeholder="留空 = 龙鲸X 数据目录"
              />
              <button
                type="button"
                onClick={() => void pickPath(setDshCwd, { title: "选择会话工作目录", directory: true })}
                className="shrink-0 rounded-md bg-neutral-800 px-3 text-sm text-neutral-300 transition-colors hover:bg-neutral-700"
              >
                浏览
              </button>
            </div>
          </Field>
          <p className="text-[11px] leading-relaxed text-neutral-500">
            调用本机 DeepSeek Harness 的 headless 档位（纯问答）。设置会话工作目录后，新会话会自动归入
            dsh 桌面端该目录的项目（改动只影响新会话，旧会话可在桌面端手动拖动归组）。
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

/* ================= 安全 ================= */

/* ================= 快捷指令 ================= */

function SnippetsPane() {
  const snippets = useStore((s) => s.snippets);
  const loadSnippets = useStore((s) => s.loadSnippets);
  const saveSnippet = useStore((s) => s.saveSnippet);
  const deleteSnippet = useStore((s) => s.deleteSnippet);

  const [editing, setEditing] = useState<{ id?: number; name: string; command: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadSnippets();
  }, [loadSnippets]);

  async function doSave() {
    if (!editing) return;
    if (!editing.name.trim() || !editing.command.trim()) {
      setError("名称和命令不能为空");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await saveSnippet(editing.name.trim(), editing.command.replace(/\r/g, ""), editing.id);
      setEditing(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function doDelete(s: { id: number; name: string }) {
    const ok = await askConfirm({
      title: "删除快捷指令",
      message: `删除「${s.name}」？`,
      okText: "删除",
      danger: true,
    });
    if (ok) void deleteSnippet(s.id);
  }

  return (
    <div className="max-w-md space-y-3">
      <p className="text-[11px] leading-relaxed text-neutral-500">
        快捷指令可从终端顶部的「⚡ 指令」菜单一键发送到当前会话（自动回车执行）。
      </p>
      <button
        onClick={() => setEditing({ name: "", command: "" })}
        className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-sky-500"
      >
        ＋ 新建指令
      </button>

      {editing && (
        <div className="space-y-2 rounded-md border border-neutral-700 bg-neutral-950 p-3">
          <Field label="名称">
            <input
              className={inputCls}
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder="如：查看磁盘占用"
              autoFocus
            />
          </Field>
          <Field label="命令">
            <textarea
              className={`${inputCls} h-20 resize-y font-mono text-xs`}
              value={editing.command}
              onChange={(e) => setEditing({ ...editing, command: e.target.value })}
              placeholder="df -h"
            />
          </Field>
          {error && <p className="text-xs text-rose-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                setEditing(null);
                setError("");
              }}
              className="rounded-md bg-neutral-800 px-3 py-1.5 text-sm text-neutral-300 transition-colors hover:bg-neutral-700"
            >
              取消
            </button>
            <button
              onClick={() => void doSave()}
              disabled={busy}
              className="rounded-md bg-sky-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-sky-500 disabled:opacity-50"
            >
              {busy ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      )}

      {snippets.length === 0 && !editing && (
        <p className="py-4 text-center text-xs text-neutral-600">暂无快捷指令，点击「新建指令」创建。</p>
      )}
      <ul className="space-y-1.5">
        {snippets.map((s) => (
          <li key={s.id} className="flex items-center gap-2 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-neutral-200">{s.name}</div>
              <div className="truncate font-mono text-[11px] text-neutral-500 select-text">{s.command}</div>
            </div>
            <button
              onClick={() => setEditing({ id: s.id, name: s.name, command: s.command })}
              className="rounded px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
            >
              编辑
            </button>
            <button
              onClick={() => void doDelete(s)}
              className="rounded px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-rose-400"
            >
              删除
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SecurityPane() {
  const securityMasterSet = useStore((s) => s.securityMasterSet);
  const setupMaster = useStore((s) => s.setupMaster);
  const clearMaster = useStore((s) => s.clearMaster);
  const lockNow = useStore((s) => s.lockNow);
  const idleLockMinutes = useStore((s) => s.idleLockMinutes);
  const setIdleLockMinutes = useStore((s) => s.setIdleLockMinutes);

  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [clearPw, setClearPw] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [busy, setBusy] = useState(false);

  async function doSetup() {
    if (pw.length < 6) {
      setError("主密码至少 6 个字符");
      return;
    }
    if (pw !== confirm) {
      setError("两次输入的密码不一致");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await setupMaster(pw);
      setSaved(true);
      setPw("");
      setConfirm("");
      setTimeout(() => setSaved(false), 1800);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function doClear() {
    if (!clearPw) {
      setError("请输入当前主密码");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await clearMaster(clearPw);
      setCleared(true);
      setClearPw("");
      setTimeout(() => setCleared(false), 1800);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-md space-y-4">
      <div
        className={`rounded-md border px-3 py-2 text-sm ${
          securityMasterSet
            ? "border-emerald-800 bg-emerald-900/20 text-emerald-300"
            : "border-neutral-800 bg-neutral-950 text-neutral-400"
        }`}
      >
        {securityMasterSet
          ? "✓ 已启用主密码加密"
          : "未设置主密码（当前为系统级加密：密钥受 Windows 凭据管理器保护）"}
      </div>

      {securityMasterSet && (
        <div className="rounded-md border border-neutral-800 bg-neutral-950 p-3">
          <div className="mb-2 text-xs font-medium text-neutral-300">锁定</div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void lockNow()}
              title="快捷键 Ctrl+Alt+L"
              className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 transition-colors hover:border-rose-500/60 hover:text-rose-300"
            >
              立即锁定
              <kbd className="ml-1.5 rounded border border-neutral-700 bg-neutral-800 px-1 py-px font-mono text-[10px] font-normal text-neutral-500">
                Ctrl+Alt+L
              </kbd>
            </button>
            <label className="ml-auto flex items-center gap-1.5 text-xs text-neutral-400">
              闲置自动锁定
              <select
                value={idleLockMinutes}
                onChange={(e) => void setIdleLockMinutes(Number(e.target.value))}
                className="rounded-md border border-neutral-700 bg-neutral-800 px-1.5 py-1 text-xs text-neutral-200 outline-none focus:border-sky-500"
              >
                {[0, 5, 10, 15, 30].map((m) => (
                  <option key={m} value={m}>
                    {m === 0 ? "关闭" : `${m} 分钟`}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="mt-2 text-[11px] text-neutral-600">
            快捷键 Ctrl+Alt+L；锁定后新建连接或查看敏感信息需重新输入主密码，已建立的会话不受影响。
          </p>
        </div>
      )}

      {!securityMasterSet ? (
        <>
          <p className="text-[11px] leading-relaxed text-neutral-500">
            设置主密码后，敏感信息改由主密码派生密钥加密，每次启动需输入主密码解锁一次。
            不设置则使用系统级加密（无感知）。
          </p>
          <Field label="新主密码（至少 6 位）">
            <input
              type="password"
              className={inputCls}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
            />
          </Field>
          <Field label="确认新主密码">
            <input
              type="password"
              className={inputCls}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>
        </>
      ) : (
        <>
          <p className="text-[11px] leading-relaxed text-neutral-500">
            更改主密码会自动重加密全部敏感信息；清除主密码则回到系统级加密。
          </p>
          <Field label="新主密码（留空 = 保持当前）">
            <input
              type="password"
              className={inputCls}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
            />
          </Field>
          <Field label="确认新主密码">
            <input
              type="password"
              className={inputCls}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>
          <Field label="当前主密码（取消加密时必填）">
            <input
              type="password"
              className={inputCls}
              value={clearPw}
              onChange={(e) => setClearPw(e.target.value)}
            />
          </Field>
        </>
      )}

      {error && <p className="text-xs text-rose-400">{error}</p>}

      <div className="flex gap-2">
        {!securityMasterSet ? (
          <button
            onClick={() => void doSetup()}
            disabled={busy}
            className="rounded-md bg-sky-600 px-4 py-1.5 text-sm text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {busy ? "处理中…" : saved ? "✓ 已设置" : "设置主密码"}
          </button>
        ) : (
          <>
            <button
              onClick={() => void doSetup()}
              disabled={busy || !pw}
              className="rounded-md bg-sky-600 px-4 py-1.5 text-sm text-white hover:bg-sky-500 disabled:opacity-50"
            >
              {busy ? "处理中…" : saved ? "✓ 已更改" : "更改主密码"}
            </button>
            <button
              onClick={() => void doClear()}
              disabled={busy || !clearPw}
              className="rounded-md border border-rose-700 px-4 py-1.5 text-sm text-rose-400 hover:bg-rose-900/30 disabled:opacity-50"
            >
              {cleared ? "✓ 已取消加密" : "取消加密（恢复系统级）"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
