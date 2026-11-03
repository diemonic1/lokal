// The Recap Stories' slides' own moving pictures (Settings > Appearance >
// Stories > Visualizations on the cards), one place to add another:
//   draw(ctx, x, y, w, h, t, colors)  draws it into the box as it is at t
//                             seconds; the same t always gives the same
//                             picture, so Share draws the moment it was pressed
//   colors                    optional: (palette) => what draw gets as colors,
//                             from the slide's song's cover (CoverGradient.jsx
//                             coverPalette, as the player bar's gradient): up
//                             to three [r, g, b], the most vivid first. Not
//                             drawn until they're read
//   slide                     the slide it's on (RecapStory.jsx buildSlides' keys)
//   place                     'card': behind the whole card, instead of the
//                             blurred cover; 'slot': in the box the slide
//                             leaves for it (SlideVisual), over the cover
//   brightness                0-1, as CSS brightness(): dimmed, so the slide
//                             reads over it
//   header                    'card' only: the share picture's header colour,
//                             continuing the picture's top (dimmed); or
//                             (colors) => it
//   frame                     'slot' only: { scale, down } drawn bigger than
//                             its box (scale x, round the middle) and lower
//                             (down x the box's height, < 0: higher); it may reach up
//                             behind the slide's text, never over it
// The phone has the same list: Lokal_android ui/SlideScenes.kt.
//
// Adding one (on both apps, the two kept alike):
// 1. The picture as a pure function of time, draw(ctx, x, y, w, h, t), in
//    src/visualizers/<name>.js: no Math.random / Date.now / state kept between
//    frames (a seeded hash for "random" shapes), drawn only inside its box,
//    see-through for 'slot'. Don't dim it there: brightness does that.
// 2. An entry here. The slide picks it up by itself (RecapStory.jsx
//    cardScene / slotScene): 'card' replaces the cover behind the whole card;
//    'slot' moves the slide's visual (SlideVisual) up under the title and
//    gives the picture the rest, down to the player.
// 3. The phone: the same drawing as DrawScope.(t) in ui/<Name>Scene.kt and an
//    entry in ui/SlideScenes.kt.
// Every scene, through the code here (never around it):
// - Settings > Appearance > Stories > Visualizations on the cards
//   (stories_card_visuals; phone: Settings > Stories, Prefs.storiesCardVisuals)
//   switches them all off: the slides go back to the blurred cover. Eco mode
//   (the phone's battery saver) doesn't: the user asked for them there too.
//   So a slide only gets one through sceneFor() under useStoriesCardVisuals()
//   (phone: SlideScene.of).
// - Share holds a still: the moment it was pressed (sceneClock() then), drawn
//   again at full size into the picture by paintScene (shareCard.js
//   renderStorySlide); the canvas on screen (SlideScene.jsx: data-scene,
//   data-share-skip) is never captured, and the Stories go on moving behind
//   the share dialog. The phone's picture is the recorded screen: the frame
//   of that moment.

import { SKY_TOP, drawSunset } from './sunset'
import { drawLotus } from './lotus'
import { drawTunnel } from './tunnel'
import { drawCubes, drawDunes, drawInterference, drawStars, drawTruchet } from './wrapped'
import { coverColors, css } from './coverColors'

/** The share picture's header over a cover-coloured scene: its darkest colour. */
const lowest = colors => css(colors.lo)

export const SLIDE_SCENES = {
  // From the user's wrapped-visuals sketches, in the cover colours of the song each slide plays.
  tunnel: { draw: drawTunnel, slide: 'track', place: 'card', brightness: 0.4, colors: coverColors, header: lowest },
  dunes: { draw: drawDunes, slide: 'tracks', place: 'card', brightness: 0.4, colors: coverColors, header: lowest },
  interference: { draw: drawInterference, slide: 'artist', place: 'card', brightness: 0.2, colors: coverColors, header: lowest },
  truchet: { draw: drawTruchet, slide: 'artists', place: 'card', brightness: 0.3, colors: coverColors, header: lowest },
  cubes: { draw: drawCubes, slide: 'session', place: 'card', brightness: 0.5, colors: coverColors, header: lowest },
  stars: { draw: drawStars, slide: 'added', place: 'card', brightness: 0.4, colors: coverColors, header: lowest },
  sunset: { draw: drawSunset, slide: 'hour', place: 'card', brightness: 0.5, header: SKY_TOP },
  lotus: { draw: drawLotus, slide: 'overview', place: 'slot', brightness: 0.85, frame: { scale: 1.2, down: -0.015 } },
}

/** The scenes' clock, in seconds: what the screen shows now, and what Share draws. */
export function sceneClock() {
  return performance.now() / 1000
}

/** The scene on `slideKey` that goes in `place`, or null. */
export function sceneFor(slideKey, place) {
  return Object.keys(SLIDE_SCENES).find(kind => SLIDE_SCENES[kind].slide === slideKey && SLIDE_SCENES[kind].place === place) || null
}

/** Draws scene `kind` into ctx's box at `t` in `colors`, dimmed as the screen shows it (the share picture). */
export function paintScene(ctx, kind, x, y, w, h, t, colors) {
  const scene = SLIDE_SCENES[kind]
  if (!scene || w < 1 || h < 1 || (scene.colors && !colors)) return
  const layer = document.createElement('canvas')
  layer.width = Math.round(w)
  layer.height = Math.round(h)
  scene.draw(layer.getContext('2d'), 0, 0, layer.width, layer.height, t, colors)
  ctx.save()
  ctx.filter = `brightness(${scene.brightness})`
  ctx.drawImage(layer, x, y, w, h)
  ctx.restore()
}
