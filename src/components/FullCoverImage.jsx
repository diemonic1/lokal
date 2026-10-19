// A song's cover shown big: its thumbnail right away, then the full-size
// picture from the song's file in its place as soon as it's read (see
// ../fullCover). Online songs and covers from the music folder are shown as
// they are.

import React from 'react'
import { trackArtURL } from '../onlineTracks'
import { useFullCover } from '../fullCover'

export default function FullCoverImage({ track, enabled = true, alt = '', ...props }) {
  const full = useFullCover(track, enabled)
  const src = full || trackArtURL(track)
  if (!src) return null
  return <img src={src} alt={alt} {...props} />
}
