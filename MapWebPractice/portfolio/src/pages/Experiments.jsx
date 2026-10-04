import { Link } from 'react-router-dom'

export default function Experiments() {
  return (
    <main className="page">
      <Link className="back" to="/">home</Link>

      <p>
        [Describe this section in a sentence. A log of experiments, sketches,
        things learned — whatever framing fits.]
      </p>

      <hr className="rule" />

      {/* Add an entry here for each experiment page you build */}
      <p>
        <Link className="link-internal" to="/experiments/map-one">
          Map experiment one
        </Link>
        {' '}— [one line describing what this one is about.]
      </p>

      {/* Copy the <p> block above for each new experiment */}
      <div className="placeholder">more experiments will appear here</div>
    </main>
  )
}
