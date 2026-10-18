import { Link } from 'react-router-dom'

export default function MapOne() {
  return (
    <main className="page">
      <Link className="back" to="/experiments">experiments</Link>

      <p>
        [Describe this map experiment. What are you exploring? What does
        the map show or let you do?]
      </p>

      {/*
        Replace this placeholder div with your Leaflet map.
        See the README for how to add Leaflet to this project.
      */}
      <div className="map-container">
        map goes here
      </div>

      <p>
        [Optional notes below the map. What you learned, what you'd do
        differently, what comes next.]
      </p>
    </main>
  )
}
