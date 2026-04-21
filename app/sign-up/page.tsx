//app/sign-up/page.tsx
'use client'
import { useState } from 'react'

export default function SignUpPage() {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const res = await fetch('/api/auth/sign-up', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, name, password }) })
    if (res.ok) {
      window.location.href = '/'
    } else {
      const data = await res.json()
      setError(data.error || 'Sign-up failed')
    }
  }

  return (
    <div className="max-w-sm mx-auto card">
      <form className="card-body space-y-3" onSubmit={onSubmit}>
        <h1 className="text-xl font-semibold">Create account</h1>
        {error && <div className="text-red-600 text-sm">{error}</div>}
        <div>
          <label className="label">Name</label>
          <input className="input" type="text" value={name} onChange={e=>setName(e.target.value)} required />
        </div>
        <div>
          <label className="label">Email</label>
          <input className="input" type="email" value={email} onChange={e=>setEmail(e.target.value)} required />
        </div>
        <div>
          <label className="label">Password</label>
          <input className="input" type="password" value={password} onChange={e=>setPassword(e.target.value)} required />
        </div>
        <button className="btn w-full" type="submit">Sign up</button>
      </form>
    </div>
  )
}
