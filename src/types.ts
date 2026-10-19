/** 与 Rust 侧 db::Host 对应（serde camelCase） */
export interface Host {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  auth_type: "password" | "key";
  password: string | null;
  key_path: string | null;
  key_passphrase: string | null;
  /** 项目分组（空串 = 默认项目） */
  project: string;
}

/** 新增/编辑主机时的载荷（id 除外） */
export type NewHost = Omit<Host, "id">;

/** 与 Rust db::Project 对应（项目树节点；parent_id = null 为根级） */
export interface ProjectInfo {
  id: number;
  name: string;
  parent_id: number | null;
}

/** 快捷指令（终端一键发送） */
export interface Snippet {
  id: number;
  name: string;
  command: string;
}

export type ConnState = "connecting" | "connected" | "error" | "closed";

export interface Tab {
  id: number;
  host: Host;
  title: string;
  state: ConnState;
  errorMessage?: string;
  session: import("./term-session").TermSession;
  /** 右侧文件侧栏是否展开（终端主区域始终挂载，互不影响） */
  filesOpen: boolean;
}

/** Rust sftp/local list 返回的目录项 */
export interface FsEntry {
  name: string;
  is_dir: boolean;
  size: number;
  mtime: number | null;
}

/** 终端常用设置 */
export interface TerminalSettings {
  fontSize: number;
  cursorBlink: boolean;
  scrollback: number;
  /** 快捷粘贴：选中即复制、右键直接粘贴（默认开；关 = xterm 默认右键菜单） */
  quickPaste: boolean;
}

/** Rust AppError 的 serde JSON 形态（tag = kind） */
export interface AppErrorPayload {
  kind:
    | "unknown_host"
    | "host_key_changed"
    | "auth"
    | "ssh"
    | "db"
    | "io"
    | "other";
  message: string;
  fingerprint?: string;
}

export function parseError(e: unknown): AppErrorPayload {
  if (typeof e === "object" && e !== null && "kind" in e) {
    return e as AppErrorPayload;
  }
  return { kind: "other", message: String(e) };
}
