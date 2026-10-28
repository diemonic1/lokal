// The side panel's Clip / Visualization tab: the whole panel is a picture,
// first that the song has (as on Visualization + Lyrics, without the lyrics):
//   1. its video, set by hand in Edit Track (ClipLoop),
//   2. its moving cover (MotionCover: a Spotify Canvas, Apple Music, Tidal...),
//   3. the side panel's fullscreen visualization.
// The built-in visualization only runs while no video shows.

import React, { useState } from 'react'
import MotionCover from './MotionCover'
import ClipLoop, { useTrackClip } from './ClipLoop'

export default function SideClip({ track, visual, visualBg, coverOff = false }) {
  const { loop, loopKey, fail: failLoop } = useTrackClip(track)
  const useLoop = !!loop
  const [loopOn, setLoopOn] = useState(false)
  const [canvasOn, setCanvasOn] = useState(false)
  const videoOn = (useLoop && loopOn) || (!useLoop && canvasOn)

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden" style={{ backgroundColor: videoOn ? '#000000' : visualBg }}>
      {!videoOn && visual}
      {useLoop ? (
        <ClipLoop key={loopKey} trackId={track?.id} link={loop.link} start={loop.start} end={loop.end} zoom={loop.zoom ?? 0}
          onActive={setLoopOn} onFail={() => { setLoopOn(false); failLoop() }} />
      ) : (
        <MotionCover trackId={track?.id} onActive={on => setCanvasOn(on)} off={coverOff} className="pointer-events-none" />
      )}
    </div>
  )
}
