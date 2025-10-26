'use client'
import React from 'react'
import Image from 'next/image'

export function ImageViewer({ src, alt }: { src: string, alt?: string }) {
  return (
    <div className="relative w-full h-64 bg-gray-100 rounded-md overflow-hidden">
      {/* using next/image for optimization */}
      <Image src={src} alt={alt || 'preview'} fill style={{objectFit:'cover'}} />
    </div>
  )
}

export function AudioPlayer({ src }: { src: string }) {
  return (
    <audio controls className="w-full mt-2">
      <source src={src} />
      Your browser does not support the audio element.
    </audio>
  )
}

export function VideoPlayer({ src }: { src: string }) {
  return (
    <video controls className="w-full rounded-md">
      <source src={src} />
      Your browser does not support the video element.
    </video>
  )
}

export function CodePreview({ code }: { code: string }) {
  return (
    <pre className="bg-gray-900 text-gray-100 p-4 rounded-md overflow-auto text-sm"><code>{code}</code></pre>
  )
}
