// The Flow tab: an endless mix of your music (see ../components/FlowPanel). It
// used to be a section of Home; old /home/flow links come here.

import React from 'react'
import { useAppStore } from '../store/player'
import { usePageReady } from '../pageCache'
import FlowPanel from '../components/FlowPanel'

export default function Flow() {
  const { user } = useAppStore()
  usePageReady(true)
  return <div className="p-6 w-full max-w-6xl mx-auto pb-10">
    <FlowPanel key={user?.id || 'guest'} userId={user?.id || 'guest'} />
  </div>
}
