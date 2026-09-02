import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import logo from '../assets/logocircl.png';

interface AuthScreenProps {
  onAuthSuccess: () => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onAuthSuccess }) => {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      if (isSignUp) {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        });
        if (signUpError) throw signUpError;
        setNotice('Compte créé. Vous pouvez maintenant vous connecter.');
        setIsSignUp(false);
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
        onAuthSuccess();
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Une erreur est survenue.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100vw', height: '100vh', padding: 20, background: 'var(--wash)' }}>
      <div className="card" style={{ width: '100%', maxWidth: 400, padding: '36px 32px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 28 }}>
          <img src={logo} alt="Circl" style={{ width: 60, height: 60, borderRadius: 18, boxShadow: 'var(--shadow-1)' }} />
          <h1 style={{ fontSize: 24, fontWeight: 700, marginTop: 14 }}>Circl</h1>
        </div>

        {error && (
          <div style={{ background: 'var(--status-dormant-soft)', color: 'var(--status-dormant)', borderRadius: 'var(--r-el)', padding: '10px 12px', marginBottom: 16, fontSize: 13, fontWeight: 600 }}>
            {error}
          </div>
        )}
        {notice && (
          <div style={{ background: 'var(--status-fresh-soft)', color: 'var(--status-fresh)', borderRadius: 'var(--r-el)', padding: '10px 12px', marginBottom: 16, fontSize: 13, fontWeight: 600 }}>
            {notice}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {isSignUp && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label className="t-label">Nom complet</label>
              <input className="input" type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} required placeholder="Votre nom" />
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label className="t-label">Email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="adresse@domaine.com" />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label className="t-label">Mot de passe</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="••••••••" />
          </div>
          <button type="submit" disabled={loading} className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 6 }}>
            {loading ? 'Traitement…' : isSignUp ? 'Créer un compte' : 'Se connecter'}
          </button>
        </form>

        <div style={{ marginTop: 18, textAlign: 'center' }}>
          <button
            onClick={() => { setIsSignUp(!isSignUp); setError(null); setNotice(null); }}
            className="btn btn-quiet"
            style={{ fontSize: 13 }}
          >
            {isSignUp ? 'J\'ai déjà un compte' : "Créer un compte"}
          </button>
        </div>
      </div>
    </div>
  );
};
