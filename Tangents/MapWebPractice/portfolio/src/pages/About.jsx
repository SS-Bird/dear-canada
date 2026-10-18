import { Link } from 'react-router-dom'

export default function About() {
  return (
    <main className="page">
      <Link className="back" to="/">home</Link>

      <p>
        [Write about yourself here. Background, interests, what you do
        professionally or personally — whatever feels right for the context
        you want to set.]
      </p>

      <p>
        [A second paragraph. You might describe how you approach your work,
        or what you're curious about right now.]
      </p>

      <p>
        [A third. No rules on length — let it be as long as it needs to be,
        and no longer.]
      </p>
    </main>
  )
}
