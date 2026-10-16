import { useMemo, useState } from "react";
import { useStore } from "../store";
import { GearIcon } from "./icons";

export function HostSidebar() {
  const collapsed = useStore((s) => s.sidebarCollapsed);
  return collapsed ? <CollapsedRail /> : <ExpandedSidebar />;
}

function CollapsedRail() {
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const openSettings = useStore((s) => s.openSettings);
  return (
    <aside className="flex w-11 shrink-0 flex-col items-center gap-2 border-r border-neutral-800 bg-neutral-950 py-2">
      <button
        onClick={toggleSidebar}
        title="展开主机栏"
        className="rounded p-1.5 text-lg text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
      >
        »
      </button>
      <span className="text-base" title="龙鲸X">🐋</span>
      <button
        onClick={() => openSettings("hosts")}
        title="设置"
        className="rounded p-1.5 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
      >
        <GearIcon />
      </button>
    </aside>
  );
}

interface GroupMenu {
  x: number;
  y: number;
  project: string;
}

function ExpandedSidebar() {
  const hosts = useStore((s) => s.hosts);
  const projects = useStore((s) => s.projects);
  const openHost = useStore((s) => s.openHost);
  const openHostForm = useStore((s) => s.openHostForm);
  const openSettings = useStore((s) => s.openSettings);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const createProject = useStore((s) => s.createProject);
  const renameProject = useStore((s) => s.renameProject);
  const deleteProject = useStore((s) => s.deleteProject);
  const tabs = useStore((s) => s.tabs);

  const [width, setWidth] = useState(232);
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const onMove = (ev: MouseEvent) => {
      setWidth(Math.min(Math.max(ev.clientX, 180), 440));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<GroupMenu | null>(null);

  // 项目并集：显式创建的项目 + 有主机的项目；「未分组」仅在存在未分组主机时显示
  const groups = useMemo(() => {
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
  }, [hosts, projects]);

  const stateOf = (hostId: number) => {
    const tab = tabs.find((t) => t.host.id === hostId);
    return tab?.state;
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

  const openGroupMenu = (e: React.MouseEvent, project: string) => {
    e.preventDefault();
    setMenu({
      x: Math.min(e.clientX, window.innerWidth - 170),
      y: Math.min(e.clientY, window.innerHeight - 120),
      project,
    });
  };

  return (
    <aside
      className="relative flex shrink-0 flex-col border-r border-neutral-800 bg-neutral-950"
      style={{ width }}
    >
      {/* 头部：操作按钮（应用名已在窗口标题栏，不再重复品牌块） */}
      <div className="flex items-center justify-end gap-1 px-3 pt-3 pb-2">
        <button
          onClick={() => void promptCreateProject()}
          title="新建项目"
          className="rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
        >
          ＋
        </button>
        <button
          onClick={() => openSettings("hosts")}
          title="设置"
          className="rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
        >
          <GearIcon />
        </button>
        <button
          onClick={toggleSidebar}
          title="折叠主机栏"
          className="rounded px-1 py-0.5 text-xs text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
        >
          «
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2" onClick={() => setMenu(null)}>
        {hosts.length === 0 && projects.length === 0 && (
          <p className="px-2 py-4 text-xs leading-relaxed text-neutral-500">
            还没有主机。
            <br />
            在「设置 → 主机」中添加，或点顶部 ＋ 新建项目。
          </p>
        )}

        {groups.map(([project, list]) => {
          const isCollapsed = collapsedGroups[project];
          const groupConnected = list.some((h) => stateOf(h.id) === "connected");
          return (
            <div key={project} className="mb-1">
              <button
                onClick={() => setCollapsedGroups((c) => ({ ...c, [project]: !c[project] }))}
                onContextMenu={(e) => openGroupMenu(e, project)}
                className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-[11px] text-neutral-500 hover:bg-neutral-900 hover:text-neutral-300"
              >
                <span className={`inline-block transition-transform ${isCollapsed ? "-rotate-90" : ""}`}>
                  ▾
                </span>
                <span className="flex-1 truncate">{project}</span>
                <span className="font-mono text-[10px] text-neutral-600">{list.length}</span>
                {groupConnected && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
              </button>
              {!isCollapsed && (
                <ul className="space-y-0.5">
                  {list.map((h) => {
                    const st = stateOf(h.id);
                    const dot =
                      st === "connected"
                        ? "bg-emerald-500"
                        : st === "connecting"
                          ? "bg-amber-400 animate-pulse"
                          : st === "error"
                            ? "bg-rose-500"
                            : "bg-neutral-600";
                    return (
                      <li key={h.id} className="group relative">
                        <button
                          onClick={() => openHost(h)}
                          className="w-full rounded-md px-2 py-1.5 pr-8 text-left transition-colors hover:bg-neutral-800/80"
                        >
                          <div className="flex items-center gap-1.5">
                            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
                            <span className="truncate text-sm text-neutral-200">{h.name}</span>
                          </div>
                          <div className="ml-3 truncate text-[11px] text-neutral-500">
                            {h.username}@{h.host}:{h.port}
                          </div>
                        </button>
                        <button
                          title="编辑"
                          onClick={() => openHostForm(h)}
                          className="absolute top-1.5 right-1.5 hidden rounded px-1 text-xs text-neutral-500 group-hover:block hover:text-neutral-200"
                        >
                          ✎
                        </button>
                      </li>
                    );
                  })}
                  {list.length === 0 && (
                    <li className="px-2.5 py-1 text-[11px] text-neutral-600">空项目 · 在设置中添加主机</li>
                  )}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {/* 项目右键菜单 */}
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

      {/* 拖宽手柄 */}
      <div
        onMouseDown={startResize}
        className="absolute top-0 right-0 h-full w-1 cursor-col-resize transition-colors hover:bg-sky-600/60"
      />
    </aside>
  );
}
