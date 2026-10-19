import type { ProjectInfo } from "./types";

/** 项目树节点（由扁平 ProjectInfo 列表构建，含展示用深度与路径） */
export interface ProjectNode {
  id: number;
  name: string;
  parentId: number | null;
  /** 层级深度，根级为 0 */
  depth: number;
  /** 完整路径，如「公司A / 研发部」 */
  pathLabel: string;
  children: ProjectNode[];
}

/**
 * 由扁平项目列表构建树：同级按中文名排序；
 * parent_id 悬空（父项被异常删除等）的节点兜底挂到根级，避免整棵树丢失
 */
export function buildProjectTree(projects: ProjectInfo[]): ProjectNode[] {
  const byId = new Map<number, ProjectNode>();
  for (const p of projects) {
    byId.set(p.id, {
      id: p.id,
      name: p.name,
      parentId: p.parent_id,
      depth: 0,
      pathLabel: p.name,
      children: [],
    });
  }
  const roots: ProjectNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId != null ? byId.get(node.parentId) : undefined;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  const walk = (nodes: ProjectNode[], depth: number, prefix: string) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    for (const n of nodes) {
      n.depth = depth;
      n.pathLabel = prefix ? `${prefix} / ${n.name}` : n.name;
      walk(n.children, depth + 1, n.pathLabel);
    }
  };
  walk(roots, 0, "");
  return roots;
}

/** 树扁平化（深度优先），供下拉框按层级缩进展示 */
export function flattenProjectTree(nodes: ProjectNode[]): ProjectNode[] {
  const out: ProjectNode[] = [];
  const walk = (list: ProjectNode[]) => {
    for (const n of list) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/** 下拉框选项文案：按深度全角空格缩进 */
export function projectOptionLabel(node: ProjectNode): string {
  return "　".repeat(node.depth) + node.name;
}
