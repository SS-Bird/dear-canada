import { Link } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

export default function Home() {
  const mapRef = useRef(null)
  const [scrollRatio, setScrollRatio] = useState(0)

  // ── Scroll listener ──────────────────────────────────────────
  useEffect(() => {
    const onScroll = () => {
      const scrolled = window.scrollY
      const maxScroll = document.body.scrollHeight - window.innerHeight
      setScrollRatio(maxScroll > 0 ? scrolled / maxScroll : 0)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // ── Leaflet map (background) ─────────────────────────────────
  useEffect(() => {
    const map = L.map(mapRef.current, {
      zoomControl: false,       // no zoom buttons — it's decorative
      scrollWheelZoom: false,
      dragging: false,
      touchZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
    }).setView([20, 10], 2)     // centred on the world

    // ── TILE LAYER ───────────────────────────────────────────────
    // This is the one line to swap when you find a style you like.
    // Browse options at: https://leaflet-extras.github.io/leaflet-providers/preview/
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap © CARTO',
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(map)

    return () => map.remove()
  }, [])

  // ── Derived styles from scroll position ──────────────────────
  // paperOpacity fades the page background out as map fades in
  const mapOpacity    = scrollRatio
  const paperOpacity  = 1 - scrollRatio * 0.85   // never fully gone — keeps text legible

  return (
    <>
      {/* ── Fixed background map ── */}
      <div
        ref={mapRef}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 0,
          opacity: mapOpacity,
          transition: 'opacity 0.1s linear',
          pointerEvents: 'none',   // click-through so text stays selectable
        }}
      />

      {/* ── Scrollable text layer ── */}
      <main
        className="page"
        style={{
          position: 'relative',
          zIndex: 1,
          backgroundColor: `rgba(245, 242, 236, ${paperOpacity})`,
        }}
      >
        <h1>Your Name — place, year</h1>

        <p>
          [Introduce yourself here. A sentence or two about who you are and what
          you spend time on. This can be as direct or oblique as you like — it
          sets the tone for everything below.]
        </p>

        <p>
          [A second paragraph. Maybe what you're working on right now, or what
          draws you to the work. You can weave in a link to{' '}
          <Link className="link-internal" to="/about">more about you</Link>{' '}
          naturally here, rather than putting it in a nav bar.]
        </p>

        <hr className="rule" />

        <p>
          Some of this site is a record of{' '}
          <Link className="link-internal" to="/experiments">experiments</Link>{' '}
          — things I'm learning or trying out. [Describe briefly what kind of
          experiments: maps, data, visuals, code sketches, whatever fits.]
        </p>

        <p>
          [Add more paragraphs and links as the site grows. Each new page just
          gets a route in App.jsx and a Link here.]
        </p>

        <hr className="rule" />

        <p>
          [Optional: a closing line. Contact info, a note about the site itself,
          or just leave it open.]
        </p>
      </main>
    </>
  )
}