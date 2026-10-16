import { useStore } from "../store";

export function FingerprintModal() {
  const prompt = useStore((s) => s.fingerprintPrompt);
  const accept = useStore((s) => s.acceptFingerprint);
  const dismiss = useStore((s) => s.dismissFingerprintPrompt);

  if (!prompt) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[26rem] rounded-lg border border-neutral-700 bg-neutral-900 p-4 shadow-xl">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
          {prompt.changed ? (
            <>
              <span className="text-rose-400">⚠</span>
              <span className="text-rose-300">主机密钥已变化</span>
            </>
          ) : (
            <>
              <span className="text-amber-400">🔐</span>
              <span className="text-neutral-200">确认主机指纹（首次连接）</span>
            </>
          )}
        </h2>

        <p className="mb-1 text-xs text-neutral-400">
          {prompt.changed
            ? "该服务器的密钥与已存指纹不一致：可能是服务器重装，也可能存在中间人风险。"
            : "首次连接该服务器，请核对下方 SHA256 指纹后选择是否信任。"}
        </p>
        <p className="mb-3 text-xs text-neutral-500">
          {prompt.host.username}@{prompt.host.host}:{prompt.host.port}
        </p>

        <code className="block rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 font-mono text-xs break-all text-emerald-300 select-text">
          {prompt.fingerprint}
        </code>

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={dismiss}
            className="rounded-md bg-neutral-800 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-700"
          >
            取消
          </button>
          <button
            onClick={() => void accept()}
            className={`rounded-md px-3 py-1.5 text-sm text-white ${
              prompt.changed
                ? "bg-rose-600 hover:bg-rose-500"
                : "bg-sky-600 hover:bg-sky-500"
            }`}
          >
            {prompt.changed ? "更新指纹并连接" : "信任并连接"}
          </button>
        </div>
      </div>
    </div>
  );
}
