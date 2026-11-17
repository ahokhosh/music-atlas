interface Props {
  onClick: () => void
  label?: string
  className?: string
}

/**
 * Big, bold, bright back button — used on every page header
 * so the back action is always easy to see and tap.
 */
export default function BackButton({ onClick, label = 'Back', className = '' }: Props) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`w-[46px] h-[46px] rounded-full bg-white/10 border border-white/25 text-white flex items-center justify-center shadow-[0_4px_16px_rgba(0,0,0,0.45)] hover:bg-white/20 hover:border-white/40 active:scale-90 transition-all flex-shrink-0 ${className}`}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="15,18 9,12 15,6" />
      </svg>
    </button>
  )
}
