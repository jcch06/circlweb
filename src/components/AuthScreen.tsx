import React, { useState } from 'react';
import { supabase } from '../lib/supabase';

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (isSignUp) {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName,
            },
          },
        });
        if (signUpError) throw signUpError;
        alert('Inscription réussie. Vous pouvez maintenant vous connecter.');
        setIsSignUp(false);
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;
        onAuthSuccess();
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Erreur système.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div className="glass-card" style={styles.card}>
        <div style={styles.logoContainer}>
          <h1 style={styles.logoText}>circl</h1>
        </div>

        {error && (
          <div style={styles.errorContainer}>
            <span style={styles.errorText}>[Erreur] {error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} style={styles.form}>
          {isSignUp && (
            <div style={styles.inputGroup}>
              <label style={styles.label}>Nom complet</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                placeholder="Identité"
                style={styles.input}
              />
            </div>
          )}

          <div style={styles.inputGroup}>
            <label style={styles.label}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="adresse@domaine.com"
              style={styles.input}
            />
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>Mot de passe</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              style={styles.input}
            />
          </div>

          <button type="submit" disabled={loading} className="btn-primary" style={styles.submitBtn}>
            {loading ? 'Traitement...' : isSignUp ? 'Créer un compte' : 'Se connecter'}
          </button>
        </form>

        <div style={styles.switchContainer}>
          <button
            onClick={() => setIsSignUp(!isSignUp)}
            style={styles.switchBtn}
          >
            {isSignUp ? 'Se connecter' : "S'inscrire"}
          </button>
        </div>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    width: '100vw',
    height: '100vh',
    padding: 20,
    background: 'var(--bg-primary)',
  },
  card: {
    width: '100%',
    maxWidth: 380,
    padding: '40px 30px',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bg-card)',
  },
  logoContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    marginBottom: 40,
  },
  logoText: {
    fontSize: '2rem',
    fontWeight: 700,
    letterSpacing: '0.05em',
  },
  errorContainer: {
    border: '1px solid #555',
    padding: 10,
    marginBottom: 20,
    textAlign: 'center',
  },
  errorText: {
    fontSize: '0.85rem',
    color: '#fff',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  inputGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  label: {
    fontSize: '0.75rem',
    fontWeight: 500,
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  input: {
    background: 'var(--bg-input)',
    border: '1px solid var(--border)',
    padding: '10px 12px',
    color: '#fff',
    fontSize: '0.9rem',
    outline: 'none',
  },
  submitBtn: {
    padding: 12,
    marginTop: 10,
    fontSize: '0.9rem',
    width: '100%',
  },
  switchContainer: {
    marginTop: 20,
    textAlign: 'center',
  },
  switchBtn: {
    background: 'none',
    border: 'none',
    color: '#888',
    fontSize: '0.8rem',
    cursor: 'pointer',
    textDecoration: 'none',
  },
};
