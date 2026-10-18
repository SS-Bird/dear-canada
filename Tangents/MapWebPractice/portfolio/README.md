# Portfolio

A personal site built with React + Vite.

## Getting started

```bash
npm install
npm run dev
```

Then open http://localhost:5173

## Project structure

```
src/
  App.jsx          # Routes — add a new <Route> here for each new page
  main.jsx         # Entry point, do not touch
  index.css        # All styles and design tokens
  pages/
    Home.jsx       # Main text page — links to everything else
    About.jsx      # About page
    Experiments.jsx  # Index of experiment pages
    MapOne.jsx     # First map experiment (placeholder)
```

## Adding a new page

1. Create `src/pages/YourPage.jsx` (copy any existing page as a template)
2. Add a route in `App.jsx`:
   ```jsx
   <Route path="/your-page" element={<YourPage />} />
   ```
3. Add a `<Link>` to it from `Home.jsx` or `Experiments.jsx`

## Adding Leaflet to a map page

```bash
npm install leaflet
```

Then in your map page component:
```jsx
import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

export default function MapOne() {
  const mapRef = useRef(null)

  useEffect(() => {
    const map = L.map(mapRef.current).setView([51.505, -0.09], 13)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(map)

    return () => map.remove()   // cleanup on unmount
  }, [])

  return (
    <main className="page">
      <div ref={mapRef} style={{ height: '420px' }} />
    </main>
  )
}
```

Note the `return () => map.remove()` — this is important in React.
Without it, navigating away and back will try to initialise Leaflet
twice on the same div and throw an error.
