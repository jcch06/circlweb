import React, { useState, useEffect } from 'react';

import { autoEnrichUserProfile, isPerplexityConfigured } from '../lib/mistral';
import { supabase } from '../lib/supabase';

interface UserProfile {
  name: string;
  company: string;
  role: string;
  skills: string[];
  currentProjects: string;
  needs: string;
}

interface UserProfilePopupProps {
  userId: string;
  onClose: () => void;
  onSave: (profile: UserProfile) => void;
}

const styles = {
  overlay: {
    position: 'fixed' as const,
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    backdropFilter: 'blur(5px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: 20,
  },
  modal: {
    background: 'var(--card-bg)',
    border: '1px solid var(--border-glow)',
    borderRadius: 16,
    width: '100%',
    maxWidth: 600,
    maxHeight: '90vh',
    overflowY: 'auto' as const,
    padding: 24,
    position: 'relative' as const,
    boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
    borderBottom: '1px solid rgba(255,255,255,0.05)',
    paddingBottom: 16,
  },
  title: {
    fontSize: '1.25rem',
    fontWeight: 600,
    color: '#fff',
    margin: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  subtitle: {
    fontSize: '0.85rem',
    color: 'var(--text-secondary)',
    margin: '4px 0 0 0',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    padding: 4,
  },
  formGroup: {
    marginBottom: 16,
  },
  label: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: '0.85rem',
    color: 'var(--text-secondary)',
    marginBottom: 6,
    fontWeight: 500,
  },
  input: {
    width: '100%',
    background: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    padding: '10px 12px',
    color: '#fff',
    fontSize: '0.9rem',
    outline: 'none',
  },
  textarea: {
    width: '100%',
    background: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    padding: '10px 12px',
    color: '#fff',
    fontSize: '0.9rem',
    outline: 'none',
    minHeight: 80,
    resize: 'vertical' as const,
  },
  tagContainer: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 6,
    marginTop: 8,
  },
  tag: {
    background: 'rgba(255,255,255,0.08)',
    border: '1px solid var(--border-hover)',
    color: '#fff',
    padding: '2px 8px',
    borderRadius: 99,
    fontSize: '0.75rem',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  tagRemove: {
    cursor: 'pointer',
    opacity: 0.7,
  },
  autoBtn: {
    width: '100%',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid var(--border-hover)',
    color: '#fff',
    padding: '12px',
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    cursor: 'pointer',
    fontSize: '0.9rem',
    fontWeight: 500,
    marginBottom: 20,
    transition: 'all 0.2s ease',
  },
  saveBtn: {
    width: '100%',
    background: '#333',
    border: 'none',
    color: '#fff',
    padding: '12px',
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    cursor: 'pointer',
    fontSize: '0.95rem',
    fontWeight: 600,
    marginTop: 24,
  }
};

export const UserProfilePopup: React.FC<UserProfilePopupProps> = ({ userId, onClose, onSave }) => {
  const [profile, setProfile] = useState<UserProfile>({
    name: '',
    company: '',
    role: '',
    skills: [],
    currentProjects: '',
    needs: ''
  });
  
  const [newSkill, setNewSkill] = useState('');
  const [enriching, setEnriching] = useState(false);

  useEffect(() => {
    const loadProfile = async () => {
      // 1. Try to fetch from Supabase
      const { data } = await supabase.auth.getUser();
      const metaProfile = data?.user?.user_metadata?.oracle_profile;
      
      if (metaProfile) {
        setProfile(metaProfile);
      } else {
        // 2. Fallback to localStorage
        const saved = localStorage.getItem(`circl_user_profile_${userId}`);
        if (saved) {
          try {
            setProfile(JSON.parse(saved));
          } catch (e) {
            console.error("Erreur parsing profil utilisateur", e);
          }
        }
      }
    };
    loadProfile();
  }, [userId]);

  const handleChange = (field: keyof UserProfile, value: any) => {
    setProfile(prev => ({ ...prev, [field]: value }));
  };

  const handleAddSkill = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && newSkill.trim()) {
      e.preventDefault();
      if (!profile.skills.includes(newSkill.trim())) {
        handleChange('skills', [...profile.skills, newSkill.trim()]);
      }
      setNewSkill('');
    }
  };

  const handleRemoveSkill = (skill: string) => {
    handleChange('skills', profile.skills.filter(s => s !== skill));
  };

  const handleAutoEnrich = async () => {
    if (!profile.name) {
      alert("Veuillez au moins renseigner votre nom pour la recherche.");
      return;
    }
    if (!isPerplexityConfigured()) {
      alert("Clé Perplexity requise pour l'auto-enrichissement web.");
      return;
    }

    setEnriching(true);
    try {
      const data = await autoEnrichUserProfile(
        profile.name, 
        profile.company, 
        profile.role
      );
      setProfile(prev => {
        const newProjects = data.currentProjects ? (prev.currentProjects ? prev.currentProjects + '\n\n[IA]: ' + data.currentProjects : data.currentProjects) : prev.currentProjects;
        const newNeeds = data.needs ? (prev.needs ? prev.needs + '\n\n[IA]: ' + data.needs : data.needs) : prev.needs;

        return {
          ...prev,
          skills: Array.from(new Set([...prev.skills, ...(data.skills || [])])),
          currentProjects: newProjects,
          needs: newNeeds,
        };
      });
    } catch (err: any) {
      alert(`Erreur d'enrichissement: ${err.message}`);
    } finally {
      setEnriching(false);
    }
  };

  const handleSave = async () => {
    // Save to Supabase to persist across sessions/devices
    try {
      await supabase.auth.updateUser({
        data: { oracle_profile: profile }
      });
    } catch (err) {
      console.error("Erreur de sauvegarde Supabase :", err);
    }
    
    // Fallback/cache local
    localStorage.setItem(`circl_user_profile_${userId}`, JSON.stringify(profile));
    onSave(profile);
    onClose();
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.modal} >
        <div style={styles.header}>
          <div>
            <h2 style={styles.title}> Mon Profil Oracle</h2>
            <p style={styles.subtitle}>Enrichissez votre profil pour que l'IA trouve des opportunités sur-mesure pour VOUS.</p>
          </div>
          <button onClick={onClose} style={styles.closeBtn}>
            
          </button>
        </div>

        <button 
          style={{ ...styles.autoBtn, opacity: enriching ? 0.7 : 1 }} 
          onClick={handleAutoEnrich}
          disabled={enriching}
          className="hover-glow"
        >
          {enriching ? (
            <><div className="orbit-spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Recherche Web en cours...</>
          ) : (
            <> Auto-Enrichir via le Web (Perplexity)</>
          )}
        </button>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Nom complet</label>
            <input 
              style={styles.input} 
              value={profile.name} 
              onChange={e => handleChange('name', e.target.value)} 
              placeholder="Ex: Elon Musk"
            />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Poste</label>
            <input 
              style={styles.input} 
              value={profile.role} 
              onChange={e => handleChange('role', e.target.value)} 
              placeholder="Ex: CEO"
            />
          </div>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>Entreprise</label>
          <input 
            style={styles.input} 
            value={profile.company} 
            onChange={e => handleChange('company', e.target.value)} 
            placeholder="Ex: SpaceX"
          />
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}> Mes Compétences (Entrée pour ajouter)</label>
          <input 
            style={styles.input} 
            value={newSkill} 
            onChange={e => setNewSkill(e.target.value)} 
            onKeyDown={handleAddSkill}
            placeholder="Ex: Développement React, Vente B2B..."
          />
          {profile.skills.length > 0 && (
            <div style={styles.tagContainer}>
              {profile.skills.map(s => (
                <span key={s} style={styles.tag}>
                  {s} <span style={{...styles.tagRemove, cursor: 'pointer', marginLeft: '6px'}} onClick={() => handleRemoveSkill(s)}>[x]</span>
                </span>
              ))}
            </div>
          )}
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}> Projets Actuels / Ce que je propose</label>
          <textarea 
            style={styles.textarea} 
            value={profile.currentProjects} 
            onChange={e => handleChange('currentProjects', e.target.value)} 
            placeholder="Quels sont vos projets actuels, vos services ou vos objectifs professionnels ?"
          />
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}> Mes Besoins / Défis</label>
          <textarea 
            style={styles.textarea} 
            value={profile.needs} 
            onChange={e => handleChange('needs', e.target.value)} 
            placeholder="Que recherchez-vous dans votre réseau ? (Ex: Je cherche des associés, des clients SaaS, des mentors...)"
          />
        </div>

        <button style={styles.saveBtn} onClick={handleSave} className="hover-glow">
           Enregistrer mon profil
        </button>
      </div>
    </div>
  );
};
