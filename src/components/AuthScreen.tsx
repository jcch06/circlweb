import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { LogIn, UserPlus, Sparkles, AlertCircle } from 'lucide-react';

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
        alert('Inscription réussie ! Vous pouvez maintenant vous connecter.');
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
      setError(err.message || 'Une erreur est survenue.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div className="bg-grid"></div>
      <div className="bg-stars"></div>
      
      <div className="glass-card" style={styles.card}>
        <div style={styles.logoContainer}>
          <div className="glow-active" style={styles.logoIcon}>
            <Sparkles size={28} color="var(--neon-purple)" />
          </div>
          <h1 style={styles.logoText}>
            CIRCL <span className="text-gradient-purple-blue">WEB</span>
          </h1>
          <p style={styles.subtitle}>Gérez et fusionnez vos galaxies de contacts</p>
        </div>

        {error && (
          <div style={styles.errorContainer}>
            <AlertCircle size={18} color="var(--neon-pink)" />
            <span style={styles.errorText}>{error}</span>
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
                placeholder="Jean Dupont"
                style={styles.input}
              />
            </div>
          )}

          <div style={styles.inputGroup}>
            <label style={styles.label}>Adresse Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="jean@exemple.com"
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
            {loading ? (
              <div className="orbit-spinner" style={{ width: 20, height: 20 }}></div>
            ) : isSignUp ? (
              <>
                <UserPlus size={18} style={{ marginRight: 8 }} />
                Créer un compte
              </>
            ) : (
              <>
                <LogIn size={18} style={{ marginRight: 8 }} />
                Se connecter
              </>
            )}
          </button>
        </form>

        <div style={styles.switchContainer}>
          <button
            onClick={() => setIsSignUp(!isSignUp)}
            style={styles.switchBtn}
          >
            {isSignUp
              ? 'Déjà un compte ? Connectez-vous'
              : "Pas de compte ? Inscrivez-vous gratuitement"}
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
    position: 'relative',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    padding: '40px 30px',
    display: 'flex',
    flexDirection: 'column',
    zIndex: 1,
    transform: 'none', // Override translateY animation on login screen for simplicity
  },
  logoContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    marginBottom: 30,
  },
  logoIcon: {
    width: 60,
    height: 60,
    borderRadius: '50%',
    background: 'rgba(159, 97, 232, 0.1)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    border: '1px solid rgba(159, 97, 232, 0.2)',
    marginBottom: 16,
  },
  logoText: {
    fontSize: '2rem',
    fontWeight: 800,
    letterSpacing: '-0.03em',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: '0.875rem',
    color: 'var(--text-secondary)',
    textAlign: 'center',
  },
  errorContainer: {
    background: 'rgba(236, 111, 139, 0.1)',
    border: '1px solid rgba(236, 111, 139, 0.2)',
    borderRadius: 8,
    padding: 12,
    display: 'flex',
    alignItems: 'center',
    marginBottom: 20,
  },
  errorText: {
    fontSize: '0.85rem',
    color: 'var(--neon-pink)',
    marginLeft: 8,
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
    fontSize: '0.8rem',
    fontWeight: 600,
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  input: {
    background: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid var(--border-glow)',
    borderRadius: 8,
    padding: '12px 16px',
    color: '#fff',
    fontSize: '0.95rem',
    outline: 'none',
    transition: 'border-color 0.2s',
  },
  submitBtn: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 14,
    marginTop: 10,
    fontSize: '1rem',
  },
  switchContainer: {
    marginTop: 24,
    textAlign: 'center',
  },
  switchBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-secondary)',
    fontSize: '0.875rem',
    cursor: 'pointer',
    textDecoration: 'underline',
    transition: 'color 0.2s',
  },
};

