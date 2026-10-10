/**
 * Optional photos for a memory. They live ONLY on this device (IndexedDB): they are never uploaded, never sent to the AI,
 * and are gone if the browser's data is cleared. The server is only told THAT a photo exists (a yes/no), so the person's
 * memory card can show it on this device.
 */

const DB = 'tg_photos'
const STORE = 'photos'
export const MAX_SIDE = 640

/** The size a photo is shrunk to: fit inside `max` on the longer side, keep the shape, never enlarge. */
export function fitWithin(width: number, height: number, max = MAX_SIDE): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: max, height: max }
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return open().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null)
        try {
          const tx = db.transaction(STORE, mode)
          const req = fn(tx.objectStore(STORE))
          req.onsuccess = () => resolve(req.result)
          req.onerror = () => resolve(null)
          tx.oncomplete = () => db.close()
          tx.onerror = () => resolve(null)
        } catch {
          resolve(null)
        }
      }),
  )
}

/** Shrinks an image file to a small JPEG, so a memory costs a few tens of kilobytes, not megabytes. */
export async function shrinkImage(file: Blob): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file)
    const { width, height } = fitWithin(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close?.()
    return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.72))
  } catch {
    return null
  }
}

/** Keeps a photo for a mission, on this device. Returns false (never throws) if it could not be kept. */
export async function keepPhoto(missionId: string, file: Blob): Promise<boolean> {
  const small = await shrinkImage(file)
  if (!small) return false
  const done = await run('readwrite', (s) => s.put(small, missionId))
  return done !== null
}

/** The photo for a mission as a temporary address for an <img>, or null. Call `URL.revokeObjectURL` when finished. */
export async function loadPhotoUrl(missionId: string): Promise<string | null> {
  const blob = await run<Blob | undefined>('readonly', (s) => s.get(missionId) as IDBRequest<Blob | undefined>)
  return blob ? URL.createObjectURL(blob) : null
}

export async function forgetPhoto(missionId: string): Promise<void> {
  await run('readwrite', (s) => s.delete(missionId))
}

/** "Delete my data" also removes every photo kept on this device. */
export async function forgetAllPhotos(): Promise<void> {
  await run('readwrite', (s) => s.clear())
}
