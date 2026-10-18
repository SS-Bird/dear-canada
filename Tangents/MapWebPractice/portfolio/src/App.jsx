import { Routes, Route } from 'react-router-dom'
import Home from './pages/Home.jsx'
import About from './pages/About.jsx'
import Experiments from './pages/Experiments.jsx'
import MapOne from './pages/MapOne.jsx'

export default function App() {
  return (
    <Routes>
      <Route path="/"             element={<Home />} />
      <Route path="/about"        element={<About />} />
      <Route path="/experiments"  element={<Experiments />} />
      <Route path="/experiments/map-one" element={<MapOne />} />
    </Routes>
  )
}
