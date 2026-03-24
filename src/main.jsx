import * as THREE from 'three'
import { createRoot } from 'react-dom/client'
import './index.css'
import DroneVerse from './DroneVerse.jsx'

// Expose Three.js globally (DroneVerse's Viewport3D uses window.THREE)
window.THREE = THREE

createRoot(document.getElementById('root')).render(<DroneVerse />)
