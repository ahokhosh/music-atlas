import mysql from 'mysql2/promise'
import path from 'path'
import fs from 'fs'
import dotenv from 'dotenv'

dotenv.config({ path: path.resolve(process.cwd(), '.env') })
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true })

let pool: mysql.Pool | null = null

export function getPool(): mysql.Pool {
  if (pool) return pool
  pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'db_playlist',
    waitForConnections: true,
    connectionLimit: 10,
    connectTimeout: 8000,
  })
  return pool
}

let dbAvailable = true
export function isDbAvailable() {
  return dbAvailable
}

async function ensureColumn(db: string, table: string, column: string, ddl: string) {
  const p = getPool()
  const [rows]: any = await p.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [db, table, column]
  )
  if (!rows[0]?.n) await p.query(`ALTER TABLE ${table} ADD COLUMN ${ddl}`)
}

export async function initDatabase() {
  const dbName = process.env.DB_NAME || 'db_playlist'
  try {
    const tempPool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '3306', 10),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      waitForConnections: true,
      connectionLimit: 5,
      connectTimeout: 8000,
    })
    await tempPool.query(`CREATE DATABASE IF NOT EXISTS ${dbName}`)
    await tempPool.end()
    const p = getPool()

    await p.query(`CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      email VARCHAR(100) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      avatar_url VARCHAR(255),
      country VARCHAR(10),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)

    await p.query(`CREATE TABLE IF NOT EXISTS playlists (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      name VARCHAR(100) NOT NULL,
      description VARCHAR(500),
      country VARCHAR(10),
      is_public BOOLEAN DEFAULT TRUE,
      cover_url VARCHAR(500),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_country (country),
      INDEX idx_user (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)

    await p.query(`CREATE TABLE IF NOT EXISTS playlist_songs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      playlist_id INT NOT NULL,
      track_id BIGINT,
      video_id VARCHAR(24),
      title VARCHAR(300),
      artist VARCHAR(300),
      album VARCHAR(300),
      cover_url VARCHAR(500),
      thumbnail VARCHAR(500),
      duration INT,
      preview_url VARCHAR(500),
      source VARCHAR(16) DEFAULT 'yt',
      position INT DEFAULT 0,
      added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
      INDEX idx_playlist (playlist_id),
      INDEX idx_video (video_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)

    await p.query(`CREATE TABLE IF NOT EXISTS cache_store (
      cache_key VARCHAR(255) PRIMARY KEY,
      cache_value MEDIUMTEXT,
      expires_at TIMESTAMP NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)

    // ---- safe migrations for pre-existing schemas ----
    await ensureColumn(dbName, 'playlist_songs', 'video_id', 'video_id VARCHAR(64) NULL')
    await ensureColumn(dbName, 'playlist_songs', 'thumbnail', 'thumbnail VARCHAR(500) NULL')
    await ensureColumn(dbName, 'playlist_songs', 'source', "source VARCHAR(16) NULL DEFAULT 'sc'")
    await ensureColumn(dbName, 'playlists', 'cover_gradient', 'cover_gradient VARCHAR(120) NULL')
    await ensureColumn(dbName, 'playlists', 'cover_emoji', 'cover_emoji VARCHAR(16) NULL')
    await ensureColumn(dbName, 'playlists', 'external_url', 'external_url VARCHAR(500) NULL')
    try {
      await p.query('ALTER TABLE playlist_songs MODIFY track_id BIGINT NULL')
      await p.query('ALTER TABLE playlist_songs MODIFY video_id VARCHAR(64) NULL')
    } catch {
      /* already migrated */
    }

    dbAvailable = true

    // ---- cache hygiene: prune expired rows at boot + every 6h ----
    // (resolve/search/trending reads skip expired rows already, but without
    // pruning the table grows forever and slows every cache read)
    const pruneExpired = () =>
      p.query('DELETE FROM cache_store WHERE expires_at IS NOT NULL AND expires_at < NOW()').catch(() => {})
    pruneExpired()
    const pruneTimer = setInterval(pruneExpired, 6 * 3600 * 1000)
    if (typeof pruneTimer.unref === 'function') pruneTimer.unref()
  } catch (err) {
    console.error('DB init failed:', err)
    dbAvailable = false
  }
}

// ---------------- cache (for music metadata resilience) ----------------
// File-backed fallback: when MySQL is unreachable (DB ready: false), the
// generic cache lives in a local JSON file instead of dying on every call.
// This keeps the hourly warmer, charts, packs and search caches working
// with zero DB. Only cache_store uses this — users/playlists still need
// the real database (auth returns 503 without it).
const FILE_CACHE_PATH = process.env.CACHE_FILE || path.resolve(process.cwd(), 'cache_store.json')
let fileCache: Map<string, { value: any; expiresAt: number | null }> | null = null
let fileSaveTimer: ReturnType<typeof setTimeout> | null = null

function loadFileCache(): Map<string, { value: any; expiresAt: number | null }> {
  if (fileCache) return fileCache
  fileCache = new Map()
  try {
    if (fs.existsSync(FILE_CACHE_PATH)) {
      const raw = JSON.parse(fs.readFileSync(FILE_CACHE_PATH, 'utf8') || '{}')
      const now = Date.now()
      for (const [k, v] of Object.entries<any>(raw)) {
        if (v && (!v.expiresAt || v.expiresAt > now)) fileCache.set(k, v)
      }
    }
  } catch { /* start empty */ }
  return fileCache
}

function scheduleFileSave() {
  if (fileSaveTimer) return
  fileSaveTimer = setTimeout(() => {
    fileSaveTimer = null
    try {
      const store = loadFileCache()
      const now = Date.now()
      const out: Record<string, any> = {}
      for (const [k, v] of store) {
        if (v && (!v.expiresAt || v.expiresAt > now)) out[k] = v
      }
      fs.writeFileSync(FILE_CACHE_PATH, JSON.stringify(out))
    } catch { /* cache is best-effort */ }
  }, 2000)
  if (typeof (fileSaveTimer as any).unref === 'function') (fileSaveTimer as any).unref()
}

function fileGet(key: string) {
  const v = loadFileCache().get(key)
  if (!v) return null
  if (v.expiresAt && v.expiresAt <= Date.now()) {
    loadFileCache().delete(key)
    scheduleFileSave()
    return null
  }
  return v
}

function fileSet(key: string, value: any, ttlSec: number) {
  loadFileCache().set(key, { value, expiresAt: Date.now() + ttlSec * 1000 })
  scheduleFileSave()
}

function fileDel(key: string) {
  if (loadFileCache().delete(key)) scheduleFileSave()
}

export async function cacheGet(key: string): Promise<{ value: any; expiresAt: number | null } | null> {
  if (dbAvailable) {
    try {
      const p = getPool()
      const [rows]: any = await p.execute('SELECT cache_value, expires_at FROM cache_store WHERE cache_key = ?', [key])
      const row = rows[0]
      if (!row) return null
      try {
        const exp = row.expires_at ? new Date(row.expires_at).getTime() : null
        return { value: JSON.parse(row.cache_value), expiresAt: exp }
      } catch {
        return null
      }
    } catch { /* fall through to file cache */ }
  }
  return fileGet(key)
}

export async function cacheSet(key: string, value: any, ttlSec: number) {
  if (dbAvailable) {
    try {
      const p = getPool()
      await p.execute(
        `INSERT INTO cache_store (cache_key, cache_value, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))
         ON DUPLICATE KEY UPDATE cache_value = VALUES(cache_value), expires_at = VALUES(expires_at)`,
        [key, JSON.stringify(value), ttlSec]
      )
    } catch { /* fall through to file cache */ }
  }
  fileSet(key, value, ttlSec)
}

export async function cacheDel(key: string) {
  if (dbAvailable) {
    try {
      const p = getPool()
      await p.execute('DELETE FROM cache_store WHERE cache_key = ?', [key])
    } catch { /* ignore */ }
  }
  fileDel(key)
}

// Long-lived stale copies: written alongside every fresh cache write and
// read ONLY when all live sources fail. This is what keeps charts/packs
// serving (slightly old) data through an upstream outage instead of going
// empty — the normal TTL entries self-delete on expiry, so without this
// there would be nothing to fall back to.
const STALE_SUFFIX = ':stale'
const STALE_TTL_SEC = 7 * 24 * 3600
export async function cacheSetStale(key: string, value: any) {
  return cacheSet(key + STALE_SUFFIX, value, STALE_TTL_SEC)
}
export async function cacheGetStale(key: string): Promise<any | null> {
  try {
    const row = await cacheGet(key + STALE_SUFFIX)
    return row ? row.value : null
  } catch {
    return null
  }
}


// ---------------- users ----------------
export async function createUser(username: string, email: string, passwordHash: string, country?: string) {
  const p = getPool()
  const [r]: any = await p.execute(
    'INSERT INTO users (username, email, password_hash, country) VALUES (?, ?, ?, ?)',
    [username, email, passwordHash, country || null]
  )
  return (r as any).insertId
}

export async function getUserByEmail(email: string) {
  const p = getPool()
  const [rows]: any = await p.execute('SELECT * FROM users WHERE email = ?', [email])
  return rows[0] || null
}

export async function getUserById(id: number) {
  const p = getPool()
  const [rows]: any = await p.execute(
    'SELECT id, username, email, avatar_url, country, created_at FROM users WHERE id = ?',
    [id]
  )
  return rows[0] || null
}

// ---------------- playlists ----------------
export interface PlaylistInput {
  name: string
  description?: string | null
  country?: string | null
  isPublic?: boolean
  coverGradient?: string | null
  coverEmoji?: string | null
}

export async function createPlaylist(userId: number, input: PlaylistInput) {
  const p = getPool()
  const [r]: any = await p.execute(
    `INSERT INTO playlists (user_id, name, description, country, is_public, cover_gradient, cover_emoji, external_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      input.name,
      input.description || null,
      input.country || null,
      input.isPublic !== false,
      input.coverGradient || null,
      input.coverEmoji || null,
      (input as any).externalUrl || null,
    ]
  )
  return (r as any).insertId
}

export async function updatePlaylist(id: number, userId: number, input: PlaylistInput) {
  const p = getPool()
  await p.execute(
    `UPDATE playlists SET name = ?, description = ?, country = ?, is_public = ?, cover_gradient = ?, cover_emoji = ?
     WHERE id = ? AND user_id = ?`,
    [
      input.name,
      input.description || null,
      input.country || null,
      input.isPublic !== false,
      input.coverGradient || null,
      input.coverEmoji || null,
      id,
      userId,
    ]
  )
}

export async function getPlaylistById(id: number) {
  const p = getPool()
  const [rows]: any = await p.execute(
    `SELECT p.*, u.username AS owner_name,
       (SELECT COUNT(*) FROM playlist_songs s WHERE s.playlist_id = p.id) AS song_count
     FROM playlists p JOIN users u ON p.user_id = u.id WHERE p.id = ?`,
    [id]
  )
  return rows[0] || null
}

export async function getUserPlaylists(userId: number) {
  const p = getPool()
  const [rows]: any = await p.execute(
    `SELECT p.*, (SELECT COUNT(*) FROM playlist_songs s WHERE s.playlist_id = p.id) AS song_count,
       (SELECT s2.thumbnail FROM playlist_songs s2 WHERE s2.playlist_id = p.id AND s2.thumbnail IS NOT NULL AND s2.thumbnail != '' ORDER BY s2.position ASC, s2.id ASC LIMIT 1) AS thumbnail
     FROM playlists p WHERE p.user_id = ? ORDER BY p.updated_at DESC`,
    [userId]
  )
  return rows
}

export async function getPublicPlaylists(country?: string, limit = 30, offset = 0) {
  const p = getPool()
  const lim = Math.min(Math.max(limit, 1), 60)
  if (country && country !== 'all') {
    const [rows]: any = await p.execute(
      `SELECT p.*, u.username AS owner_name,
         (SELECT COUNT(*) FROM playlist_songs s WHERE s.playlist_id = p.id) AS song_count,
         (SELECT s2.thumbnail FROM playlist_songs s2 WHERE s2.playlist_id = p.id AND s2.thumbnail IS NOT NULL AND s2.thumbnail != '' ORDER BY s2.position ASC, s2.id ASC LIMIT 1) AS thumbnail
       FROM playlists p JOIN users u ON p.user_id = u.id
       WHERE p.is_public = TRUE AND p.country = ?
       ORDER BY p.updated_at DESC LIMIT ${lim} OFFSET ${offset}`,
      [country]
    )
    return rows
  }
  const [rows]: any = await p.execute(
    `SELECT p.*, u.username AS owner_name,
       (SELECT COUNT(*) FROM playlist_songs s WHERE s.playlist_id = p.id) AS song_count,
       (SELECT s2.thumbnail FROM playlist_songs s2 WHERE s2.playlist_id = p.id AND s2.thumbnail IS NOT NULL AND s2.thumbnail != '' ORDER BY s2.position ASC, s2.id ASC LIMIT 1) AS thumbnail
     FROM playlists p JOIN users u ON p.user_id = u.id
     WHERE p.is_public = TRUE
     ORDER BY p.updated_at DESC LIMIT ${lim} OFFSET ${offset}`
  )
  return rows
}

export async function deletePlaylist(id: number, userId: number) {
  const p = getPool()
  await p.execute('DELETE FROM playlists WHERE id = ? AND user_id = ?', [id, userId])
}


// ---------------- songs ----------------
export async function addSongToPlaylist(
  playlistId: number,
  track: {
    videoId?: string
    trackId?: number
    title: string
    artist: string
    thumbnail?: string
    cover?: string
    duration?: number
    directUrl?: string
    source?: string
  }
) {
  const p = getPool()
  const vid = track.videoId || null
  if (vid) {
    const [rows]: any = await p.execute(
      'SELECT id FROM playlist_songs WHERE playlist_id = ? AND video_id = ?',
      [playlistId, vid]
    )
    if (rows[0]) return { duplicate: true, id: rows[0].id }
  }
  const [max]: any = await p.execute(
    'SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM playlist_songs WHERE playlist_id = ?',
    [playlistId]
  )
  const position = Number(max[0]?.pos) || 0
  const [r]: any = await p.execute(
    `INSERT INTO playlist_songs (playlist_id, track_id, video_id, title, artist, cover_url, thumbnail, duration, preview_url, source, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      playlistId,
      track.trackId ?? null,
      vid,
      track.title,
      track.artist,
      track.cover || track.thumbnail || null,
      track.thumbnail || null,
      track.duration || 0,
      track.directUrl || null,
      track.source || detectSource(vid, track.directUrl),
      position,
    ]
  )
  return { duplicate: false, id: (r as any).insertId }
}

function detectSource(vid: string | null, directUrl?: string): string {
  if (!vid) return directUrl ? 'direct' : 'sc'
  if (vid.startsWith('sc_')) return 'sc'
  if (vid.startsWith('sp_')) return 'spotify'
  if (vid.startsWith('it_')) return 'itunes'
  if (vid.startsWith('dz_')) return 'deezer'
  return 'legacy'
}

export async function removeSongFromPlaylist(playlistId: number, songId: number) {
  const p = getPool()
  await p.execute('DELETE FROM playlist_songs WHERE playlist_id = ? AND id = ?', [playlistId, songId])
}

export async function getPlaylistSongs(playlistId: number) {
  const p = getPool()
  const [rows]: any = await p.execute(
    'SELECT * FROM playlist_songs WHERE playlist_id = ? ORDER BY position ASC, id ASC',
    [playlistId]
  )
  return rows.map((s: any) => {
    const src = s.source || 'yt'
    return {
      id: s.id,
      videoId: s.video_id || (s.track_id ? `dz_${s.track_id}` : null),
      title: s.title,
      artist: s.artist,
      thumbnail: s.thumbnail || s.cover_url || '',
      duration: s.duration || 0,
      directUrl: src === 'direct' ? s.preview_url || undefined : undefined,
    }
  })
}

export async function reorderSongs(playlistId: number, songIds: number[]) {
  const p = getPool()
  const conn = await p.getConnection()
  try {
    await conn.beginTransaction()
    for (let i = 0; i < songIds.length; i++) {
      await conn.execute('UPDATE playlist_songs SET position = ? WHERE id = ? AND playlist_id = ?', [
        i,
        songIds[i],
        playlistId,
      ])
    }
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

