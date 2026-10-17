import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useStore, DEFAULT_PROJECT_NAME } from "../store";
import type { NewHost } from "../types";
import { showMessage } from "./dialogs";

/** 批量添加主机：一份公共配置 + 多行地址列表（每行一个；「名称,地址」可整行指定名称；# 开头为注释行） */
export function BatchAddModal({ onClose }: { onClose: () => void }) {
  const hosts = useStore((s) => s.hosts);
  const projects = useStore((s) => s.projects);
  const loadHosts = useStore((s) => s.loadHosts);

  const [text, setText] = useState("");
  const [nameTpl, setNameTpl] = useState("{last}");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("root");
  const [project, setProject] = useState("");
  const [authType, setAuthType] = useState<"password" | "key">("password");
  const [password, setPassword] = useState("");
  const [keyPath, setKeyPath] = useState("");
  const [keyPassphrase, setKeyPassphrase] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // 解析地址列表：跳过空行/注释行，行内按地址去重；名称支持模板 {n}=序号 {ip}=地址 {last}=IPv4 末段
  const parsed = useMemo(() => {
    const rows: { name: string; addr: string }[] = [];
    const seenAddr = new Set<string>();
    let n = 1;
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      let name = "";
      let addr = line;
      const c = line.indexOf("，") >= 0 ? line.indexOf("，") : line.indexOf(",");
      if (c > 0) {
        name = line.slice(0, c).trim();
        addr = line.slice(c + 1).trim();
      }
      if (!addr || seenAddr.has(addr)) continue;
      seenAddr.add(addr);
      if (!name) {
        const last = addr.split(".").pop() || addr;
        name = nameTpl
          .replace(/\{n\}/g, () => String(n))
          .replace(/\{ip\}/g, () => addr)
          .replace(/\{last\}/g, () => last);
      }
      rows.push({ name, addr });
      n += 1;
    }
    return rows;
  }, [text, nameTpl]);

  async function submit() {
    if (parsed.length === 0) {
      setError("地址列表为空");
      return;
    }
    const portNum = Number(port);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      setError("端口必须是 1-65535 的整数");
      return;
    }
    if (!username.trim()) {
      setError("用户名不能为空");
      return;
    }
    if (authType === "key" && !keyPath.trim()) {
      setError("密钥认证需要填写私钥路径");
      return;
    }
    // 名称与现有主机及本批次去重
    const taken = new Set(hosts.map((h) => h.name));
    const list: NewHost[] = parsed.map((r) => {
      let name = r.name;
      let i = 2;
      while (taken.has(name)) name = `${r.name}-${i++}`;
      taken.add(name);
      return {
        name,
        host: r.addr,
        port: portNum,
        username: username.trim(),
        auth_type: authType,
        password: authType === "password" && password ? password : null,
        key_path: authType === "key" ? keyPath.trim() : null,
        key_passphrase: authType === "key" && keyPassphrase ? keyPassphrase : null,
        project,
      };
    });
    setSaving(true);
    setError("");
    try {
      const count = await invoke<number>("hosts_batch_add", { hosts: list });
      await loadHosts();
      onClose();
      void showMessage(`已添加 ${count} 台主机`);
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60">
      <div className="w-[520px] rounded-lg border border-neutral-700 bg-neutral-900 p-4 shadow-xl">
        <h2 className="mb-3 text-sm font-semibold text-neutral-200">批量添加主机</h2>

        <div className="space-y-2.5">
          <Field label="地址列表（每行一个 IP/域名；「名称,地址」可指定名称；# 开头为注释行）">
            <textarea
              className={`${inputCls} h-32 resize-y font-mono text-xs`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"192.168.1.101\n192.168.1.102\nnode03,10.0.0.3"}
              autoFocus
            />
          </Field>
          <div className="flex gap-2">
            <Field label={"{n}=序号 {ip}=地址 {last}=IP末段"} className="flex-1">
              <input
                className={inputCls}
                value={nameTpl}
                onChange={(e) => setNameTpl(e.target.value)}
                placeholder="名称模板"
              />
            </Field>
            <Field label="端口" className="w-24">
              <input
                className={inputCls}
                value={port}
                onChange={(e) => setPort(e.target.value)}
                placeholder="22"
              />
            </Field>
          </div>
          <div className="flex gap-2">
            <Field label="用户名" className="flex-1">
              <input
                className={inputCls}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="root"
              />
            </Field>
            <Field label="所属项目" className="flex-1">
              <select
                className={inputCls}
                value={project}
                onChange={(e) => setProject(e.target.value)}
              >
                <option value="">{DEFAULT_PROJECT_NAME}</option>
                {projects
                  .filter((p) => p !== "")
                  .map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
              </select>
            </Field>
          </div>
          <Field label="认证方式">
            <div className="flex gap-4 text-sm text-neutral-300">
              <label className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="radio"
                  checked={authType === "password"}
                  onChange={() => setAuthType("password")}
                />
                密码
              </label>
              <label className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="radio"
                  checked={authType === "key"}
                  onChange={() => setAuthType("key")}
                />
                私钥
              </label>
            </div>
          </Field>
          {authType === "password" ? (
            <Field label="公共密码">
              <input
                type="password"
                className={inputCls}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="所有主机共用；本机加密存储"
              />
            </Field>
          ) : (
            <div className="flex gap-2">
              <Field label="私钥路径" className="flex-1">
                <input
                  className={inputCls}
                  value={keyPath}
                  onChange={(e) => setKeyPath(e.target.value)}
                  placeholder="C:\Users\you\.ssh\id_ed25519"
                />
              </Field>
              <Field label="私钥口令（可选）" className="flex-1">
                <input
                  type="password"
                  className={inputCls}
                  value={keyPassphrase}
                  onChange={(e) => setKeyPassphrase(e.target.value)}
                />
              </Field>
            </div>
          )}

          {/* 预览 */}
          <div className="rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2">
            <p className="text-[11px] text-neutral-500">
              将创建 {parsed.length} 台主机{project ? ` · ${project}` : ` · ${DEFAULT_PROJECT_NAME}`}
            </p>
            {parsed.length > 0 && (
              <ul className="mt-1 max-h-28 overflow-y-auto text-[11px] text-neutral-400">
                {parsed.map((r) => (
                  <li key={r.addr} className="truncate">
                    {r.name} <span className="text-neutral-600">← {r.addr}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className={btnCls("secondary")}>
            取消
          </button>
          <button
            onClick={() => void submit()}
            disabled={saving || parsed.length === 0}
            className={btnCls("primary")}
          >
            {saving ? "创建中…" : `创建 ${parsed.length} 台`}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-md border border-neutral-700 bg-neutral-800 px-2.5 py-1.5 text-sm text-neutral-200 outline-none focus:border-sky-500";

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs text-neutral-400">{label}</span>
      {children}
    </label>
  );
}

function btnCls(variant: "primary" | "secondary") {
  return variant === "primary"
    ? "rounded-md bg-sky-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-sky-500 disabled:opacity-50"
    : "rounded-md bg-neutral-800 px-3 py-1.5 text-sm text-neutral-300 transition-colors hover:bg-neutral-700";
}
