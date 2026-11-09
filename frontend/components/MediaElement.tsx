export type MediaKind = "image" | "audio" | "video"

const mediaExtRegex: Record<MediaKind, RegExp> = {
  image: /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i,
  audio: /\.(mp3|wav|ogg|flac|m4a|aac|opus)$/i,
  video: /\.(mp4|webm|mov|mkv|avi|m4v|ogv)$/i,
}

export function mediaKindOf(file: File): MediaKind | null {
  if (file.type.startsWith("image/")) return "image"
  if (file.type.startsWith("audio/")) return "audio"
  if (file.type.startsWith("video/")) return "video"
  for (const kind of ["image", "audio", "video"] as const) {
    if (mediaExtRegex[kind].test(file.name)) return kind
  }
  return null
}

export function mediaKindOfType(contentType: string): MediaKind | null {
  if (contentType.startsWith("image/")) return "image"
  if (contentType.startsWith("audio/")) return "audio"
  if (contentType.startsWith("video/")) return "video"
  return null
}

interface MediaElementProps {
  kind: MediaKind
  src: string
  name: string
  className?: string
}

export function MediaElement({ kind, src, name, className = "" }: MediaElementProps) {
  if (kind === "image") {
    return <img src={src} alt={name} className={`max-w-full h-auto mx-auto block ${className}`} />
  }
  if (kind === "audio") {
    return <audio src={src} controls className={`w-full ${className}`} aria-label={name} />
  }
  return <video src={src} controls className={`max-w-full h-auto mx-auto block ${className}`} aria-label={name} />
}
