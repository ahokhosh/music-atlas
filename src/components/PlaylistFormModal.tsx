import { useEffect, useState } from 'react'
import Modal from './Modal'
import CoverArt, { GRADIENT_PRESETS, EMOJI_PRESETS } from './CoverArt'
import { COUNTRIES, getCountry } from '../data/countries'
import { api, type Playlist } from '../services/api'
import { toast } from './Toast'

interface Props {
  open: boolean
  onClose: () => void
  onSaved: (p: Playlist) => void
  editing?: Playlist | null
  defaultCountry?: string
}

export default function PlaylistFormModal({ open, onClose, onSaved, editing, defaultCountry }: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [country, setCountry] = useState('')
  const [isPublic, setIsPublic] = useState(true)
  const [gradient, setGradient] = useState<string>(GRADIENT_PRESETS[0])
  const [emoji, setEmoji] = useState<string>(EMOJI_PRESETS[0])
  const [filter, setFilter] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    if (editing) {
      setName(editing.name)
      setDescription(editing.description || '')
      setCountry(editing.country || '')
      setIsPublic(!!editing.is_public)
      setGradient(editing.cover_gradient || GRADIENT_PRESETS[0])
      setEmoji(editing.cover_emoji || EMOJI_PRESETS[0])
    } else {
      setName('')
      setDescription('')
      setCountry(defaultCountry || '')
      setIsPublic(true)
      setGradient(GRADIENT_PRESETS[Math.floor(Math.random() * GRADIENT_PRESETS.length)])
      setEmoji(EMOJI_PRESETS[Math.floor(Math.random() * EMOJI_PRESETS.length)])
    }
    setFilter('')
  }, [open, editing, defaultCountry])

  const submit = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      const body = {
        name: name.trim(),
        description: description.trim(),
        country: country || null,
        isPublic,
        coverGradient: gradient,
        coverEmoji: emoji,
      }
      const res = editing
        ? await api<{ playlist: Playlist }>(`/playlists/${editing.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : await api<{ playlist: Playlist }>('/playlists', { method: 'POST', body: JSON.stringify(body) })
      toast(editing ? 'Playlist updated' : 'Playlist created')
      onSaved(res.playlist)
      onClose()
    } catch (e: any) {
      toast(e?.status === 401 ? 'Please sign in first' : 'Could not save playlist', 'err')
    } finally {
      setSaving(false)
    }
  }

  const filtered = COUNTRIES.filter(
    (c) => c.name.toLowerCase().includes(filter.toLowerCase()) || c.code.toLowerCase().includes(filter.toLowerCase())
  ).slice(0, 60)

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit playlist' : 'New playlist'}>
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <CoverArt gradient={gradient} emoji={emoji} seed={name} className="w-20 h-20 rounded-2xl flex-shrink-0" emojiSize="text-4xl" />
          <div className="flex-1 min-w-0">
            <input className="input !py-2.5" placeholder="Playlist name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
        </div>

        <div>
          <span className="label">Cover color</span>
          <div className="flex gap-2 flex-wrap">
            {GRADIENT_PRESETS.map((g) => (
              <button
                key={g}
                onClick={() => setGradient(g)}
                className={`w-8 h-8 rounded-full transition-transform ${gradient === g ? 'ring-2 ring-white ring-offset-2 ring-offset-[#12121c] scale-110' : 'hover:scale-110'}`}
                style={{ background: g }}
              />
            ))}
          </div>
        </div>

        <div>
          <span className="label">Cover icon</span>
          <div className="flex gap-1.5 flex-wrap">
            {EMOJI_PRESETS.map((e) => (
              <button
                key={e}
                onClick={() => setEmoji(e)}
                className={`w-9 h-9 rounded-xl text-lg flex items-center justify-center transition-all ${emoji === e ? 'bg-violet-500/25 ring-1 ring-violet-400' : 'hover:bg-white/8'}`}
              >
                {e}
              </button>
            ))}
          </div>
        </div>

        <input className="input !py-2.5" placeholder="Description (optional)" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />

        <div>
          <span className="label">Country vibe {country && `· ${getCountry(country)?.flag} ${getCountry(country)?.name}`}</span>
          <input className="input !py-2.5 mb-2" placeholder="Filter countries…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <div className="max-h-36 overflow-y-auto no-scrollbar flex flex-wrap gap-1.5 pr-1">
            <button className={`pill !py-1.5 !text-[12px] ${!country ? 'active' : ''}`} onClick={() => setCountry('')}>🌍 Global</button>
            {filtered.map((c) => (
              <button
                key={c.code}
                className={`pill !py-1.5 !text-[12px] ${country === c.code ? 'active' : ''}`}
                onClick={() => setCountry(c.code)}
              >
                {c.flag} {c.name}
              </button>
            ))}
          </div>
        </div>

        <button
          className="w-full flex items-center justify-between p-3.5 rounded-xl border border-white/10"
          onClick={() => setIsPublic(!isPublic)}
        >
          <span className="text-left">
            <span className="block text-[13.5px] font-semibold">Public</span>
            <span className="block text-[11.5px] text-(--text-dim)">Visible on country pages</span>
          </span>
          <span className={`w-11 h-6 rounded-full p-0.5 transition-colors ${isPublic ? 'bg-violet-500' : 'bg-white/15'}`}>
            <span className={`block w-5 h-5 rounded-full bg-white transition-transform ${isPublic ? 'translate-x-5' : ''}`} />
          </span>
        </button>

        <button className="btn btn-primary w-full" disabled={!name.trim() || saving} onClick={submit}>
          {saving ? 'Saving…' : editing ? 'Save changes' : 'Create playlist'}
        </button>
      </div>
    </Modal>
  )
}
