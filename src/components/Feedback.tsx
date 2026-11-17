export function TrackSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-2">
          <div className="skeleton w-[76px] h-[76px] rounded-[18px] flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-3.5 rounded-md" style={{ width: `${55 + ((i * 17) % 30)}%` }} />
            <div className="skeleton h-3 rounded-md w-1/3" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function CardSkeleton({ n = 4 }: { n?: number }) {
  return (
    <div className="flex gap-3 overflow-hidden">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="skeleton w-40 h-48 rounded-2xl flex-shrink-0" />
      ))}
    </div>
  )
}

export function Spinner({ size = 22 }: { size?: number }) {
  return (
    <div
      className="rounded-full border-2 border-white/20 border-t-violet-400 animate-spin"
      style={{ width: size, height: size }}
    />
  )
}

export function EmptyState({ icon, title, sub, action }: { icon: string; title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="text-center py-14 px-4">
      <div className="text-5xl mb-4 opacity-60">{icon}</div>
      <p className="font-semibold text-[15px] mb-1">{title}</p>
      {sub && <p className="text-[13px] text-(--text-dim) max-w-xs mx-auto">{sub}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
