function hueOf(text: string): number {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360
  return h
}

export function gradientFor(seed: string): string {
  const h = hueOf(seed || 'ta')
  return `linear-gradient(135deg, hsl(${h},68%,42%), hsl(${(h + 55) % 360},72%,30%))`
}

export const GRADIENT_PRESETS = [
  'linear-gradient(135deg,#8b5cf6,#ec4899)',
  'linear-gradient(135deg,#06b6d4,#3b82f6)',
  'linear-gradient(135deg,#f59e0b,#ef4444)',
  'linear-gradient(135deg,#10b981,#0ea5e9)',
  'linear-gradient(135deg,#f43f5e,#a21caf)',
  'linear-gradient(135deg,#64748b,#1e293b)',
  'linear-gradient(135deg,#84cc16,#059669)',
  'linear-gradient(135deg,#f97316,#eab308)',
]

export const EMOJI_PRESETS = [
  '🎵', '🎧', '🎸', '🎹', '🥁', '🎤', '🎷', '🎻', '🌙', '☀️',
  '🔥', '💫', '🌈', '❤️', '🌊', '🏔️', '🌴', '🌍', '🦋', '⭐',
]

interface Props {
  gradient?: string | null
  emoji?: string | null
  seed?: string
  className?: string
  emojiSize?: string
}

export default function CoverArt({ gradient, emoji, seed = '?', className = '', emojiSize = 'text-3xl' }: Props) {
  const bg = gradient || gradientFor(seed)
  return (
    <div className={`relative overflow-hidden flex items-center justify-center ${className}`} style={{ background: bg }}>
      <div
        className="absolute inset-0 opacity-30"
        style={{ background: 'radial-gradient(circle at 30% 20%, rgba(255,255,255,0.35), transparent 55%)' }}
      />
      <span className={`relative ${emojiSize} drop-shadow-lg select-none`}>{emoji || '🎵'}</span>
    </div>
  )
}
