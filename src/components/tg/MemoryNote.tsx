import { useEffect, useRef, useState } from 'react'
import { Camera, X } from 'lucide-react'
import { NOTE_MAX } from '@/shared/mission-record'
import { Button } from '@/components/ui/button'

type Props = {
  note: string
  onNote: (n: string) => void
  photo: File | null
  onPhoto: (f: File | null) => void
  disabled?: boolean
}

/** A few words and an optional photo to remember this by. Short, optional, and private: the photo never leaves this device. */
export function MemoryNote({ note, onNote, photo, onPhoto, disabled }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)

  useEffect(() => {
    if (!photo) {
      setPreview(null)
      return
    }
    const url = URL.createObjectURL(photo)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [photo])

  return (
    <div className="space-y-2">
      <label htmlFor="memory-note" className="text-sm font-medium">
        Anything you want to remember? <span className="font-normal text-muted-foreground">(optional)</span>
      </label>
      <textarea
        id="memory-note"
        value={note}
        onChange={(e) => onNote(e.target.value.slice(0, NOTE_MAX))}
        maxLength={NOTE_MAX}
        rows={3}
        disabled={disabled}
        placeholder="A detail, a feeling, something you found…"
        className="w-full resize-none rounded-xl border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <input ref={input} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-label="Choose a photo to keep" onChange={(e) => onPhoto(e.target.files?.[0] ?? null)} disabled={disabled} />
          {preview ? (
            <div className="flex items-center gap-2">
              <img src={preview} alt="The photo you chose" className="size-12 rounded-lg border object-cover" />
              <Button variant="ghost" size="sm" onClick={() => onPhoto(null)} disabled={disabled}>
                <X className="size-4" aria-hidden="true" /> Remove photo
              </Button>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => input.current?.click()} disabled={disabled}>
              <Camera className="size-4" aria-hidden="true" /> Add a photo
            </Button>
          )}
        </div>
        <span className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
          {note.length}/{NOTE_MAX}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">Only you can see this. A photo stays on this device and is never uploaded.</p>
    </div>
  )
}
