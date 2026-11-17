import { ReactNode, useEffect } from 'react'

interface Props {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
}

export default function Modal({ open, onClose, title, children }: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label={title || 'Dialog'}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div className="relative w-full sm:max-w-md max-h-[85dvh] overflow-y-auto no-scrollbar rounded-t-3xl sm:rounded-3xl bg-[#12121c] border border-white/10 animate-sheet-up sm:animate-scale-in">
        <div className="sticky top-0 glass rounded-t-3xl px-5 pt-4 pb-3 flex items-center justify-between z-10">
          <div className="w-9 sm:hidden flex justify-center absolute left-1/2 -translate-x-1/2 top-2">
            <div className="w-10 h-1 rounded-full bg-white/20" />
          </div>
          <h3 className="text-base font-bold">{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="px-5 pb-8 pt-2 safe-b">{children}</div>
      </div>
    </div>
  )
}
