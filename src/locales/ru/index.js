// All Russian phrases, keyed by the English phrase (see ../../i18n.jsx). Split
// by area of the app; a phrase in more than one file takes the later one.
import core from './core'
import settings from './settings'
import settingsParts from './settings-parts'
import player from './player'
import library from './library'
import online from './online'
import pages from './pages'
import radio from './radio'
import topbarsClips from './topbars-clips'

export default { ...core, ...settings, ...settingsParts, ...player, ...library, ...online, ...pages, ...radio, ...topbarsClips }
