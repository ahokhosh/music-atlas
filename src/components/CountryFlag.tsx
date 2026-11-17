import { useState } from 'react'

interface Props {
  code: string
  hue?: number
  className?: string
  /** circular crop (avatars, chips) instead of the classic 4:3 rectangle */
  circle?: boolean
}

/**
 * Real SVG flag per country (flagcdn, lazy + cached by the browser).
 * Zero bundle cost, offline-safe: any missing flag falls back to a
 * gradient tile with the country code — never a broken image.
 * (Emoji flags render as plain letters on Windows, so SVG is used everywhere.)
 */
export default function CountryFlag({ code, hue = 250, className = 'w-12', circle = false }: Props) {
  const [failed, setFailed] = useState(false)
  const cc = code.toLowerCase()
  const shape = circle ? 'rounded-full' : 'rounded-lg'
  const ratio = circle ? { aspectRatio: '1 / 1' } : { aspectRatio: '4 / 3' }

  if (failed) {
    return (
      <div
        className={`${className} ${shape} flex items-center justify-center overflow-hidden flex-shrink-0 border border-white/10`}
        style={{
          ...ratio,
          background: `linear-gradient(135deg, hsl(${hue},60%,32%), hsl(${(hue + 50) % 360},55%,18%))`,
        }}
      >
        <span className="text-[10px] font-extrabold tracking-widest text-white/90">{code.toUpperCase()}</span>
      </div>
    )
  }

  return (
    <div
      className={`${className} ${shape} overflow-hidden flex-shrink-0 bg-white/5 border border-white/10 shadow-sm`}
      style={ratio}
    >
      <img
        src={`https://flagcdn.com/${cc}.svg`}
        alt={`${code} flag`}
        loading="lazy"
        draggable={false}
        className="w-full h-full object-cover"
        onError={() => setFailed(true)}
      />
    </div>
  )
}
