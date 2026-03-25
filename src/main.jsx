import * as THREE from 'three'
import { createRoot } from 'react-dom/client'
import './index.css'
import DroneVerse from './DroneVerse.jsx'

// Expose Three.js globally (DroneVerse's Viewport3D uses window.THREE)
window.THREE = THREE

// Prevent browser zoom (Cmd+/Cmd-/Ctrl+/Ctrl-) — app handles its own scaling
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '-' || e.key === '=' || e.key === '0')) {
    e.preventDefault()
  }
})

// Prevent pinch zoom and Ctrl+wheel zoom
document.addEventListener('wheel', (e) => {
  if (e.ctrlKey || e.metaKey) e.preventDefault()
}, { passive: false })

// Counter-scale if page was already zoomed before load
function counterZoom() {
  const zoomLevel = Math.round(window.devicePixelRatio * 100) / 100
  // devicePixelRatio includes both screen DPR and browser zoom
  // We can't reliably separate them, so use visualViewport API
  if (window.visualViewport) {
    const scale = window.visualViewport.scale
    if (scale !== 1) {
      document.getElementById('root').style.transform = `scale(${1 / scale})`
      document.getElementById('root').style.transformOrigin = 'top left'
      document.getElementById('root').style.width = `${100 * scale}%`
      document.getElementById('root').style.height = `${100 * scale}%`
    }
  }
}

window.visualViewport?.addEventListener('resize', counterZoom)

createRoot(document.getElementById('root')).render(<DroneVerse />)
