/** 龙鲸标志：鲸身流线 + 龙角 + 龙须（渐变） */
export function Logo({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-label="龙鲸X">
      <defs>
        <linearGradient id="lj-body" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#0ea5e9" />
          <stop offset="0.55" stopColor="#38bdf8" />
          <stop offset="1" stopColor="#818cf8" />
        </linearGradient>
        <linearGradient id="lj-horn" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#f59e0b" />
          <stop offset="1" stopColor="#fbbf24" />
        </linearGradient>
      </defs>
      {/* 鲸身：自左下尾柄向右上扬起的流线体，背脊内收模拟龙脊弧线 */}
      <path
        d="M10 45
           C 10 34, 20 23, 33 22
           C 44 21, 54 27, 56 36
           C 57 41, 53 45, 48 44
           C 49 41, 47 38, 43 39
           C 35 41, 24 43, 17 50
           C 13 54, 9 51, 10 45 Z"
        fill="url(#lj-body)"
      />
      {/* 尾鳍 */}
      <path
        d="M11 44 C 5 41, 2 34, 4 27 C 8 31, 12 33, 15 37 C 13 40, 12 42, 11 44 Z"
        fill="url(#lj-body)"
        opacity="0.85"
      />
      {/* 龙角（金）：从额顶向后掠出 */}
      <path d="M40 21 C 40 13, 45 7, 53 5 C 49 11, 48 16, 47 22 Z" fill="url(#lj-horn)" />
      {/* 第二支短角 */}
      <path d="M46 21 C 47 16, 50 12, 55 11 C 52 15, 51 18, 50 22 Z" fill="url(#lj-horn)" opacity="0.8" />
      {/* 龙须：口吻处一道上扬细须 */}
      <path
        d="M55 34 C 59 35, 60 39, 57 42"
        stroke="#7dd3fc"
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
      />
      {/* 眼 */}
      <circle cx="46.5" cy="29" r="1.7" fill="#0b1220" />
    </svg>
  );
}

/** AI 星芒图标（替代 🤖 emoji） */
export function AiSpark({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M11 4l1.7 4.9a1.6 1.6 0 0 0 1 1L18.6 11.6a.3.3 0 0 1 0 .57l-4.9 1.7a1.6 1.6 0 0 0-1 1L11 19.8a.3.3 0 0 1-.57 0l-1.7-4.9a1.6 1.6 0 0 0-1-1L2.8 12.2a.3.3 0 0 1 0-.57l4.9-1.7a1.6 1.6 0 0 0 1-1L10.4 4a.3.3 0 0 1 .57 0z" />
      <path
        d="M18.5 3.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z"
        opacity="0.65"
      />
    </svg>
  );
}

/** 设置齿轮图标 */
export function GearIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.35a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.65 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.65 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.65a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09c0 .68.4 1.3 1.03 1.56a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.26.63.88 1.03 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51.97z" />
    </svg>
  );
}

/** 安全（盾牌） */
export function ShieldIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M12 3l7 3v5c0 5-3.2 8.4-7 10-3.8-1.6-7-5-7-10V6l7-3z" />
      <path d="M9 12l2 2 4-4.5" />
    </svg>
  );
}

/** 安全（盾牌） */

/** 外观（调节滑杆） */
export function SlidersIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className={className} aria-hidden="true">
      <path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h13M21 17h-1" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="19" cy="17" r="2" />
    </svg>
  );
}

/** 主机（服务器机架） */
export function ServerIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className={className} aria-hidden="true">
      <rect x="3.5" y="4" width="17" height="7" rx="1.8" />
      <rect x="3.5" y="13" width="17" height="7" rx="1.8" />
      <path d="M7 7.5h.01M7 16.5h.01" />
      <path d="M11 7.5h4M11 16.5h4" opacity="0.55" />
    </svg>
  );
}
