import { useMemo, useState } from "react";
import { useStore, DEFAULT_PROJECT_NAME } from "../store";
import { buildProjectTree, type ProjectNode } from "../projects";
import type { Host } from "../types";
import { GearIcon } from "./icons";
import { askConfirm, askText, showMessage } from "./dialogs";

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

/** 右键菜单目标；node = null 表示「默认项目」（系统分组） */
interface GroupMenu {
  x: number;
  y: number;
  node: ProjectNode | null;
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
  const duplicateHost = useStore((s) => s.duplicateHost);
  const removeHost = useStore((s) => s.removeHost);
  const moveHost = useStore((s) => s.moveHost);
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

  const [collapsedGroups, setCollapsedGroups] = useState<Record<number, boolean>>({});
  const [menu, setMenu] = useState<GroupMenu | null>(null);
  // 拖拽换组：dragOverKey = 当前高亮的项目 id（0 = 默认项目）；dragging = 有主机正被拖动
  const [dragOverKey, setDragOverKey] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  /** 投放处理：主机 id → 换到目标项目 */
  const dropHostTo = (target: string) => {
    return (e: React.DragEvent) => {
      e.preventDefault();
      setDragOverKey(null);
      setDragging(false);
      const id = Number(e.dataTransfer.getData("text/plain"));
      const host = useStore.getState().hosts.find((h) => h.id === id);
      if (!host || host.project.trim() === target) return;
      void moveHost(id, target).catch((err) =>
        showMessage({ title: "移动失败", message: String(err) }),
      );
    };
  };

  const dropHighlight = (active: boolean) =>
    active ? " bg-sky-900/50 ring-1 ring-sky-600" : "";

  // 项目树（同级按中文名排序）+ 按项目名索引主机；默认项目（空串）单独一组
  const tree = useMemo(() => buildProjectTree(projects), [projects]);
  const byProject = useMemo(() => {
    const m = new Map<string, Host[]>();
    for (const h of hosts) {
      const key = h.project.trim();
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(h);
    }
    return m;
  }, [hosts]);
  const hostsOf = (node: ProjectNode) => byProject.get(node.name) ?? [];
  const defaultHosts = byProject.get("") ?? [];

  const stateOf = (hostId: number) => {
    const tab = tabs.find((t) => t.host.id === hostId);
    return tab?.state;
  };

  /** 主机行（侧栏树节点与默认项目组共用） */
  const renderHost = (h: Host) => {
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
      <li
        key={h.id}
        className="group relative"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", String(h.id));
          setDragging(true);
        }}
        onDragEnd={() => {
          setDragging(false);
          setDragOverKey(null);
        }}
      >
        <button
          title="双击连接主机；按住可拖动到其他项目"
          onDoubleClick={() => openHost(h)}
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
        <div className="absolute top-1 right-1.5 hidden items-center gap-0.5 rounded group-hover:flex">
          <button
            title="复制主机"
            onClick={() => void duplicateHost(h.id)}
            className="rounded px-1 text-xs text-neutral-500 hover:text-neutral-200"
          >
            ⧉
          </button>
          <button
            title="编辑"
            onClick={() => openHostForm(h)}
            className="rounded px-1 text-xs text-neutral-500 hover:text-neutral-200"
          >
            ✎
          </button>
          <button
            title="删除主机"
            onClick={() => {
              void (async () => {
                const inUse = useStore.getState().tabs.some((t) => t.host.id === h.id);
                const ok = await askConfirm({
                  title: "删除主机",
                  message: `确定删除「${h.name}」？${inUse ? "与之连接的标签页将一并关闭。" : ""}`,
                  okText: "删除",
                  danger: true,
                });
                if (!ok) return;
                try {
                  await removeHost(h.id);
                } catch (e) {
                  void showMessage({ title: "删除失败", message: String(e) });
                }
              })();
            }}
            className="rounded px-1 text-xs text-neutral-500 hover:text-rose-400"
          >
            🗑
          </button>
        </div>
      </li>
    );
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

  const openGroupMenu = (e: React.MouseEvent, node: ProjectNode | null) => {
    e.preventDefault();
    setMenu({
      x: Math.min(e.clientX, window.innerWidth - 170),
      y: Math.min(e.clientY, window.innerHeight - 150),
      node,
    });
  };

  /** 递归渲染一个项目节点：标题行 + 直属主机 + 子项目（顺序与旧版一致：主机在前） */
  const renderGroup = (node: ProjectNode) => {
    const list = hostsOf(node);
    const isCollapsed = collapsedGroups[node.id];
    const groupConnected = list.some((h) => stateOf(h.id) === "connected");
    return (
      <div key={node.id} className="mb-1">
        <div
          onContextMenu={(e) => openGroupMenu(e, node)}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setDragOverKey(node.id);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOverKey(null);
          }}
          onDrop={dropHostTo(node.name)}
          style={{ paddingLeft: 6 + node.depth * 12 }}
          className={`flex w-full items-center gap-1 rounded pr-1.5 py-1 text-left text-[11px] text-neutral-500 hover:bg-neutral-900${dropHighlight(dragOverKey === node.id)}`}
        >
          <button
            onClick={() => setCollapsedGroups((c) => ({ ...c, [node.id]: !c[node.id] }))}
            className="flex min-w-0 flex-1 items-center gap-1 rounded text-left hover:text-neutral-300"
          >
            <span className={`inline-block transition-transform ${isCollapsed ? "-rotate-90" : ""}`}>
              ▾
            </span>
            <span className="min-w-0 flex-1 truncate" title={node.pathLabel}>
              {node.name}
            </span>
          </button>
          <span className="font-mono text-[10px] text-neutral-600">{list.length}</span>
          {groupConnected && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
          <button
            title="在此项目下添加主机"
            onClick={() => openHostForm(null, node.name)}
            className="rounded px-0.5 text-xs leading-none text-neutral-600 hover:text-neutral-200"
          >
            ＋
          </button>
        </div>
        {!isCollapsed && (
          <>
            <ul className="space-y-0.5" style={{ marginLeft: node.depth * 12 }}>
              {list.map(renderHost)}
              {list.length === 0 && node.children.length === 0 && (
                <li className="px-2.5 py-1 text-[11px] text-neutral-600">空项目 · 点旁 ＋ 添加主机</li>
              )}
            </ul>
            {node.children.map((child) => renderGroup(child))}
          </>
        )}
      </div>
    );
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
          <div className="px-3 py-6 text-center text-[11px] leading-relaxed text-neutral-600">
            <p className="mb-1.5 text-xs text-neutral-400">暂无主机</p>
            <p>点顶部 ＋ 新建项目</p>
            <p>再点项目旁 ＋ 添加主机</p>
          </div>
        )}

        {tree.map(renderGroup)}

        {/* 默认项目（系统分组，不属于树）固定在最后；有此类主机时常显，拖拽期间浮现作投放区 */}
        {(defaultHosts.length > 0 || dragging) && (
          <div key={0} className="mb-1">
            <div
              onContextMenu={(e) => openGroupMenu(e, null)}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setDragOverKey(0);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOverKey(null);
              }}
              onDrop={dropHostTo("")}
              className={`flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-[11px] text-neutral-500 hover:bg-neutral-900${dropHighlight(dragOverKey === 0)}`}
            >
              <button
                onClick={() => setCollapsedGroups((c) => ({ ...c, [0]: !c[0] }))}
                className="flex min-w-0 flex-1 items-center gap-1 rounded text-left hover:text-neutral-300"
              >
                <span className={`inline-block transition-transform ${collapsedGroups[0] ? "-rotate-90" : ""}`}>
                  ▾
                </span>
                <span className="min-w-0 flex-1 truncate">{DEFAULT_PROJECT_NAME}</span>
              </button>
              <span className="font-mono text-[10px] text-neutral-600">{defaultHosts.length}</span>
              {defaultHosts.some((h) => stateOf(h.id) === "connected") && (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              )}
              <button
                title="在此项目下添加主机"
                onClick={() => openHostForm(null, "")}
                className="rounded px-0.5 text-xs leading-none text-neutral-600 hover:text-neutral-200"
              >
                ＋
              </button>
            </div>
            {!collapsedGroups[0] && (
              <ul className="space-y-0.5">{defaultHosts.map(renderHost)}</ul>
            )}
          </div>
        )}
      </div>

      {/* 项目右键菜单 */}
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

      {/* 拖宽手柄 */}
      <div
        onMouseDown={startResize}
        className="absolute top-0 right-0 h-full w-1 cursor-col-resize transition-colors hover:bg-sky-600/60"
      />
    </aside>
  );
}
