import { useState } from "react";
import { useStore } from "../store";
import { ShieldIcon } from "./icons";

/** 设置了主密码时，启动后弹出解锁框（解锁一次，本次运行内有效） */
export function UnlockModal() {
  const securityMasterSet = useStore((s) => s.securityMasterSet);
  const masterPassword = useStore((s) => s.masterPassword);
  const unlockDismissed = useStore((s) => s.unlockDismissed);
  const pendingConnect = useStore((s) => s.pendingConnect);
  const unlockMaster = useStore((s) => s.unlockMaster);
  const skipUnlock = useStore((s) => s.skipUnlock);
  const resumePendingConnect = useStore((s) => s.resumePendingConnect);

  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  // 有待续连的连接请求时，即使之前点过「稍后再说」也强制弹出
  if (!securityMasterSet || masterPassword !== null || (unlockDismissed && !pendingConnect)) {
    return null;
  }

  async function submit() {
    if (!pw || busy) return;
    setBusy(true);
    setErr("");
    const ok = await unlockMaster(pw);
    if (!ok) {
      setErr("主密码错误");
      setBusy(false);
    } else {
      resumePendingConnect();
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70">
      <div className="w-96 rounded-lg border border-neutral-700 bg-neutral-900 p-5 shadow-xl">
        <div className="mb-3 flex items-center gap-2">
          <ShieldIcon className="h-5 w-5 text-sky-400" />
          <h2 className="text-sm font-semibold text-neutral-200">输入主密码解锁</h2>
        </div>
        <p className="mb-3 text-[11px] leading-relaxed text-neutral-500">
          已启用主密码加密，本次运行内输入一次即可。
        </p>
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
          autoFocus
          className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-2.5 py-1.5 text-sm text-neutral-200 outline-none focus:border-sky-500"
          placeholder="主密码"
        />
        {err && <p className="mt-2 text-xs text-rose-400">{err}</p>}
        <div className="mt-4 flex items-center justify-between">
          <button
            onClick={skipUnlock}
            className="text-[11px] text-neutral-600 hover:text-neutral-400"
          >
            稍后再说（部分功能不可用）
          </button>
          <button
            onClick={() => void submit()}
            disabled={busy || !pw}
            className="rounded-md bg-sky-600 px-4 py-1.5 text-sm text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {busy ? "验证中…" : "解锁"}
          </button>
        </div>
      </div>
    </div>
  );
}
