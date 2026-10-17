import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useStore, DEFAULT_PROJECT_NAME } from "../store";
import type { NewHost } from "../types";

export function HostFormModal() {
  const hostForm = useStore((s) => s.hostForm);
  const closeHostForm = useStore((s) => s.closeHostForm);
  const saveHost = useStore((s) => s.saveHost);
  const projects = useStore((s) => s.projects);
  const master = useStore((s) => s.masterPassword);
  const editing = hostForm?.editing ?? null;

  const [name, setName] = useState(editing?.name ?? "");
  const [host, setHost] = useState(editing?.host ?? "");
  const [port, setPort] = useState(String(editing?.port ?? 22));
  const [username, setUsername] = useState(editing?.username ?? "root");
  const [project, setProject] = useState(editing?.project ?? hostForm?.project ?? "");
  const [authType, setAuthType] = useState<"password" | "key">(
    editing?.auth_type ?? "password",
  );
  const [password, setPassword] = useState(editing?.password ?? "");
  const [keyPath, setKeyPath] = useState(editing?.key_path ?? "");
  const [keyPassphrase, setKeyPassphrase] = useState(editing?.key_passphrase ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<
    { ok: boolean; latency_ms: number; message: string; fp_note?: string } | null
  >(null);

  if (!hostForm) return null;

  async function browseKeyFile() {
    const file = await open({
      multiple: false,
      directory: false,
      title: "选择私钥文件",
    });
    if (typeof file === "string") setKeyPath(file);
  }

  async function testConnection() {
    if (!host.trim() || !username.trim()) {
      setTestResult(null);
      setError("测试前请先填写主机地址与用户名");
      return;
    }
    const portNum = Number(port);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      setTestResult(null);
      setError("端口必须是 1-65535 的整数");
      return;
    }
    setTesting(true);
    setTestResult(null);
    setError("");
    try {
      const r = await invoke<{
        ok: boolean;
        latency_ms: number;
        message: string;
        fp_note?: string;
      }>("ssh_test", {
        master: master ?? null,
        hostId: editing?.id ?? null,
        host: host.trim(),
        port: portNum,
        username: username.trim(),
        authType,
        password: authType === "password" && password ? password : null,
        keyPath: authType === "key" && keyPath.trim() ? keyPath.trim() : null,
        keyPassphrase: authType === "key" && keyPassphrase ? keyPassphrase : null,
      });
      setTestResult(r);
    } catch (e) {
      setTestResult({ ok: false, latency_ms: 0, message: String(e) });
    } finally {
      setTesting(false);
    }
  }

  async function submit() {
    if (!name.trim() || !host.trim() || !username.trim()) {
      setError("名称、主机地址、用户名不能为空");
      return;
    }
    const portNum = Number(port);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      setError("端口必须是 1-65535 的整数");
      return;
    }
    if (authType === "key" && !keyPath.trim()) {
      setError("密钥认证需要填写私钥路径");
      return;
    }
    const data: NewHost = {
      name: name.trim(),
      host: host.trim(),
      port: portNum,
      username: username.trim(),
      auth_type: authType,
      password: authType === "password" ? password : null,
      key_path: authType === "key" ? keyPath.trim() : null,
      key_passphrase: authType === "key" && keyPassphrase ? keyPassphrase : null,
      project: project.trim(),
    };
    setSaving(true);
    setError("");
    try {
      await saveHost(data, editing?.id);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60">
      <div className="w-96 rounded-lg border border-neutral-700 bg-neutral-900 p-4 shadow-xl">
        <h2 className="mb-3 text-sm font-semibold text-neutral-200">
          {editing ? "编辑主机" : "添加主机"}
        </h2>

        <div className="space-y-2.5">
          <Field label="名称">
            <input
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如：昇腾训练机 A"
              autoFocus
            />
          </Field>
          <div className="flex gap-2">
            <Field label="主机地址" className="flex-1">
              <input
                className={inputCls}
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="IP 或域名"
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
          <Field label="用户名">
            <input
              className={inputCls}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="root"
            />
          </Field>
          <Field label="所属项目（未选择则归入默认项目）">
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
            <Field label="密码">
              <input
                type="password"
                className={inputCls}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={editing ? "留空表示不修改密码（已加密存储）" : "将加密存储于本机"}
              />
            </Field>
          ) : (
            <>
              <Field label="私钥路径">
                <div className="flex gap-2">
                  <input
                    className={inputCls}
                    value={keyPath}
                    onChange={(e) => setKeyPath(e.target.value)}
                    placeholder="C:\Users\you\.ssh\id_ed25519"
                  />
                  <button
                    type="button"
                    onClick={() => void browseKeyFile()}
                    className="shrink-0 rounded-md bg-neutral-800 px-3 text-sm text-neutral-300 transition-colors hover:bg-neutral-700"
                  >
                    浏览…
                  </button>
                </div>
              </Field>
              <Field label="私钥口令（可选）">
                <input
                  type="password"
                  className={inputCls}
                  value={keyPassphrase}
                  onChange={(e) => setKeyPassphrase(e.target.value)}
                />
              </Field>
            </>
          )}
        </div>

        {testResult && (
          <div className="mt-2 text-xs">
            <p className={testResult.ok ? "text-emerald-400" : "text-rose-400"}>
              {testResult.ok
                ? `✓ ${testResult.message} · ${testResult.latency_ms}ms`
                : `✗ ${testResult.message}`}
            </p>
            {testResult.fp_note && (
              <p className="mt-1 text-amber-400">{testResult.fp_note}</p>
            )}
          </div>
        )}

        {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={() => void testConnection()}
            disabled={testing || saving}
            className={btnCls("secondary")}
          >
            {testing ? "测试中…" : "测试连接"}
          </button>
          <button onClick={closeHostForm} className={btnCls("secondary")}>
            取消
          </button>
          <button onClick={() => void submit()} disabled={saving} className={btnCls("primary")}>
            {saving ? "保存中…" : "保存"}
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
