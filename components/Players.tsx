'use client'

import React, { CSSProperties, useMemo } from 'react'
import Image from 'next/image'

type TextBlock = {
  title?: string
  body?: string
}

export function ImageViewer({ src, alt }: { src: string; alt?: string }) {
  return (
    <div className="relative h-[28rem] w-full overflow-hidden rounded-xl bg-gray-100">
      <Image src={src} alt={alt || 'preview'} fill className="object-contain" />
    </div>
  )
}

export function AudioPlayer({ src }: { src: string }) {
  return (
    <audio controls className="mt-2 w-full rounded-xl border border-gray-200 bg-white p-4">
      <source src={src} />
      Your browser does not support the audio element.
    </audio>
  )
}

export function VideoPlayer({ src }: { src: string }) {
  return (
    <video controls className="w-full rounded-xl border border-gray-200 bg-black">
      <source src={src} />
      Your browser does not support the video element.
    </video>
  )
}

export function CodePreview({
  code,
  language,
  filename,
  notes,
}: {
  code: string
  language?: string
  filename?: string
  notes?: TextBlock[]
}) {
  const lines = code.split('\n')
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-gray-950 text-gray-100">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-800 px-4 py-3 text-xs text-gray-300">
        <div className="font-medium">{filename || 'Preview snippet'}</div>
        <div className="text-gray-400">{language || 'Code preview'}</div>
      </div>
      <div className="max-h-[32rem] overflow-auto">
        <div className="grid min-w-full grid-cols-[auto,1fr]">
          <div className="select-none border-r border-gray-800 bg-gray-900/80 px-3 py-4 text-right text-xs text-gray-500">
            {lines.map((_, index) => (
              <div key={index}>{index + 1}</div>
            ))}
          </div>
          <pre className="overflow-auto p-4 text-sm leading-6">
            <code>{code}</code>
          </pre>
        </div>
      </div>
      {notes?.length ? (
        <div className="space-y-3 border-t border-gray-800 bg-gray-900/90 px-4 py-4 text-sm text-gray-200">
          {notes.map((note, index) => (
            <div key={`${note.title || 'note'}-${index}`} className="space-y-1">
              {note.title ? <div className="font-medium text-gray-100">{note.title}</div> : null}
              {note.body ? <div className="whitespace-pre-wrap text-gray-300">{note.body}</div> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function DocumentPreview({ src }: { src: string }) {
  return (
    <div className="space-y-3">
      <iframe src={src} className="h-[40rem] w-full rounded-xl border border-gray-200 bg-white" title="Document preview" />
      <div className="text-sm text-gray-500">
        If the inline viewer is blocked by the browser or storage policy, open the preview file in a new tab.
      </div>
    </div>
  )
}

export function FontPreview({ src, sampleText }: { src: string; sampleText?: string }) {
  const fontFamily = useMemo(() => `preview-font-${Math.random().toString(36).slice(2)}`, [])
  return (
    <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-6">
      <style>{`@font-face { font-family: '${fontFamily}'; src: url('${src}'); }`}</style>
      <div style={{ fontFamily } as CSSProperties} className="space-y-3">
        <div className="text-5xl">{sampleText || 'Sphinx of black quartz, judge my vow.'}</div>
        <div className="text-2xl">ABCDEFGHIJKLMNOPQRSTUVWXYZ</div>
        <div className="text-xl">abcdefghijklmnopqrstuvwxyz 0123456789</div>
      </div>
    </div>
  )
}

export function FilePreview({
  href,
  label,
  mimeType,
  sizeBytes,
  message,
}: {
  href?: string | null
  label?: string
  mimeType?: string | null
  sizeBytes?: number | null
  message?: string
}) {
  return (
    <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-600">
      <div className="space-y-1">
        <div className="text-base font-semibold text-gray-900">Generic file preview</div>
        <div>{message || 'This asset uses a file-based preview rather than an inline media player.'}</div>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-gray-200 p-3">
          <div className="text-xs uppercase tracking-wide text-gray-500">Preview label</div>
          <div className="mt-1 font-medium text-gray-900">{label || 'Preview file'}</div>
        </div>
        <div className="rounded-lg border border-gray-200 p-3">
          <div className="text-xs uppercase tracking-wide text-gray-500">MIME type</div>
          <div className="mt-1 break-all font-medium text-gray-900">{mimeType || 'Unknown'}</div>
        </div>
        <div className="rounded-lg border border-gray-200 p-3">
          <div className="text-xs uppercase tracking-wide text-gray-500">Approx. size</div>
          <div className="mt-1 font-medium text-gray-900">{typeof sizeBytes === 'number' ? `${(sizeBytes / 1024 / 1024).toFixed(2)} MB` : 'Not provided'}</div>
        </div>
      </div>
      {href ? (
        <div className="flex flex-wrap gap-3">
          <a href={href} target="_blank" rel="noreferrer" className="btn-secondary">
            Open preview file
          </a>
        </div>
      ) : null}
    </div>
  )
}
