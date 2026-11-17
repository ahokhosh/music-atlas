// Trending-by-genre catalog — slugs verified against the official
// SoundCloud charts API (soundcloud:genres:<slug>), shared by client & server.
// `set` = the matching system set on soundcloud.com/discover
// (e.g. /discover/sets/trending-by-genre:trap) — same source as the
// discover page tiles, resolved when the charts endpoint comes up empty.
export interface Genre {
  slug: string
  name: string
  hue: number
  /** discover system set (trending-by-genre:<set>) — exact discover content */
  set?: string
  /** verified charts-api genre slug; absent = skip the charts layer */
  charts?: string
}

export const GENRES: Genre[] = [
  { slug: 'all-music', name: 'All Genres', hue: 265, set: 'all-genres', charts: 'all-music' },
  { slug: 'trap', name: 'Trap', hue: 0, set: 'trap', charts: 'trap' },
  { slug: 'pop', name: 'Pop', hue: 315, set: 'pop', charts: 'pop' },
  { slug: 'hiphoprap', name: 'Hip-Hop', hue: 35, set: 'hip-hop', charts: 'hiphoprap' },
  { slug: 'electronic', name: 'Electronic', hue: 190, set: 'electronic', charts: 'electronic' },
  { slug: 'rbsoul', name: 'R&B', hue: 280, set: 'r-n-b', charts: 'rbsoul' },
  { slug: 'alt-hip-hop', name: 'Alt Hip-Hop', hue: 25, set: 'alternative-hip-hop' },
  { slug: 'indie', name: 'Indie', hue: 150, set: 'indie', charts: 'indie' },
  { slug: 'dubstep', name: 'Dubstep', hue: 215, set: 'dubstep', charts: 'dubstep' },
  { slug: 'danceedm', name: 'Dance', hue: 205, charts: 'danceedm' },
  { slug: 'rock', name: 'Rock', hue: 10, charts: 'rock' },
  { slug: 'latin', name: 'Latin', hue: 45, charts: 'latin' },
  { slug: 'house', name: 'House', hue: 170, charts: 'house' },
  { slug: 'lofi', name: 'Lofi', hue: 200, set: 'lo-fi' },
]

export const GENRE_MAP: Record<string, Genre> = Object.fromEntries(
  GENRES.map((g) => [g.slug, g])
)

export function getGenre(slug?: string | null): Genre | null {
  return slug ? GENRE_MAP[slug.toLowerCase()] || null : null
}
