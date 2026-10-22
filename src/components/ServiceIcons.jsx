import React from 'react'

// Coloured marks for the "Search on ..." items of a song's right-click menu
// (see ../trackLinks). They take a lucide icon's size / className, but stay at
// full opacity: a brand colour dimmed by the menu's icon opacity looks washed out.

function Mark({ size = 14, className = '', children }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} style={{ opacity: 1 }} aria-hidden="true">
      {children}
    </svg>
  )
}

export function YoutubeMark(props) {
  return (
    <Mark {...props}>
      <rect x="1" y="4" width="22" height="16" rx="5" fill="#ff0000" />
      <path d="m10 8 6 4-6 4Z" fill="white" />
    </Mark>
  )
}

export function GeniusMark(props) {
  return (
    <Mark {...props}>
      <rect x="2" y="2" width="20" height="20" rx="5" fill="#ffff64" />
      <path d="M7.2 7.2a4.2 4.2 0 0 0-.8 4.6M10.6 7.2v1.8a1.3 1.3 0 0 1-1.3 1.3M15.2 7.2a5.6 5.6 0 0 1-7.6 9.4" fill="none" stroke="black" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </Mark>
  )
}

export function BeatSaverMark(props) {
  return (
    <Mark {...props}>
      <rect x="4.5" y="4.5" width="15" height="15" rx="2.5" transform="rotate(45 12 12)" fill="#ff0a8c" />
      <path d="M12.9 12.7 18.7 11.5 11.5 18.9Z" fill="white" stroke="white" strokeWidth="0.9" strokeLinejoin="round" />
    </Mark>
  )
}
