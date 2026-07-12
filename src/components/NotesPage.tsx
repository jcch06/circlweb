import React, { useState, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { FileText, Plus, X, Search, Clock, User } from 'lucide-react';

interface NotesPageProps {
  notes: any[];
  contacts: any[];
  user: any;
  onRefreshData: () => Promise<void>;
}

export const NotesPage: React.FC<NotesPageProps> = ({
  notes,
  contacts,
  user,
  onRefreshData
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [loading, setLoading] = useState(false);

  // Form Fields
  const [contactId, setContactId] = useState(contacts[0]?.id || '');
  const [context, setContext] = useState<'professional' | 'personal'>('professional');
  const [content, setContent] = useState('');

  // Filter notes by search query
  const filteredNotes = useMemo(() => {
    let list = [...notes].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    if (searchTerm.trim() !== '') {
      const term = searchTerm.toLowerCase();
      list = list.filter(n => {
        const contact = contacts.find(c => c.id === n.contact_id);
        const contactName = contact ? `${contact.first_name} ${contact.last_name}`.toLowerCase() : '';
        return n.content.toLowerCase().includes(term) || contactName.includes(term);
      });
    }
    return list;
  }, [notes, contacts, searchTerm]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactId || !content.trim()) {
      alert("Veuillez sélectionner un contact et écrire du contenu.");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.from('notes').insert({
        contact_id: contactId,
        author_id: user.id,
        content: content.trim(),
        context: context,
        is_private: false
      });

      if (error) throw error;

      // Reset form
      setContent('');
      setContext('professional');
      setShowAddForm(false);
      
      await onRefreshData();
    } catch (err: any) {
      console.error(err);
      alert(`Erreur d'insertion : ${err.message || 'Impossible d\'ajouter la note.'}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Notes d'Échanges</h1>
          <p style={styles.subtitle}>Consignez et retrouvez les comptes-rendus de vos rendez-vous</p>
        </div>
        <button 
          onClick={() => {
            setShowAddForm(!showAddForm);
            setContactId(contacts[0]?.id || '');
          }} 
          disabled={contacts.length === 0}
          className="btn-primary" 
          style={styles.addBtn}
        >
          {showAddForm ? <X size={16} style={{ marginRight: 6 }} /> : <Plus size={16} style={{ marginRight: 6 }} />}
          {showAddForm ? 'Fermer' : 'Nouvelle Note'}
        </button>
      </div>

      {/* Add Note Form */}
      {showAddForm && (
        <form onSubmit={handleSubmit} className="glass-card glow-active" style={styles.formCard}>
          <h3 style={styles.formTitle}>Ajouter une note de réunion ou d'échange</h3>
          <div style={styles.formGrid}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Contact associé *</label>
              <select 
                value={contactId} 
                onChange={(e) => setContactId(e.target.value)} 
                required 
                style={styles.select}
              >
                <option value="">Sélectionner un contact...</option>
                {contacts.map(c => (
                  <option key={c.id} value={c.id}>{c.first_name} {c.last_name} {c.company ? `(${c.company})` : ''}</option>
                ))}
              </select>
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Contexte de l'échange *</label>
              <select 
                value={context} 
                onChange={(e) => setContext(e.target.value as any)} 
                required 
                style={styles.select}
              >
                <option value="professional">💼 Professionnel</option>
                <option value="personal">🏠 Personnel / Informel</option>
              </select>
            </div>
            <div style={{ ...styles.formGroup, gridColumn: 'span 2' }}>
              <label style={styles.label}>Contenu du compte-rendu *</label>
              <textarea 
                value={content} 
                onChange={(e) => setContent(e.target.value)} 
                required
                placeholder="Rédigez les points clés abordés, les besoins identifiés, les décisions prises ou les prochaines actions de relance..."
                style={styles.textarea} 
              />
            </div>
          </div>
          <button type="submit" disabled={loading} className="btn-primary" style={styles.submitBtn}>
            {loading ? 'Création de la note...' : 'Ajouter la Note 🚀'}
          </button>
        </form>
      )}

      {/* Search Block */}
      <div className="glass-card" style={styles.searchBlock}>
        <Search size={18} color="var(--text-secondary)" style={{ marginRight: 10 }} />
        <input 
          type="text" 
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Rechercher par mot clé ou par nom de contact..." 
          style={styles.searchInput}
        />
      </div>

      {/* Notes List */}
      <div style={styles.notesList}>
        {filteredNotes.length === 0 ? (
          <div style={styles.emptyState}>
            <FileText size={32} color="var(--text-muted)" style={{ marginBottom: 8 }} />
            <span>Aucune note d'échange disponible.</span>
          </div>
        ) : (
          filteredNotes.map(n => {
            const contact = contacts.find(c => c.id === n.contact_id);
            const isProfessional = n.context === 'professional';

            return (
              <div key={n.id} className="glass-card" style={styles.noteCard}>
                <div style={styles.noteHeader}>
                  <div style={styles.contactDetails}>
                    <div style={styles.avatar}>
                      <User size={14} color="#fff" />
                    </div>
                    <div>
                      <span style={styles.contactName}>
                        {contact ? `${contact.first_name} ${contact.last_name}` : 'Contact inconnu'}
                      </span>
                      {contact?.company && (
                        <span style={styles.contactCompany}> @ {contact.company}</span>
                      )}
                    </div>
                  </div>

                  <div style={styles.metaRow}>
                    <span style={{
                      ...styles.contextBadge,
                      color: isProfessional ? 'var(--neon-blue)' : 'var(--neon-yellow)',
                      backgroundColor: isProfessional ? 'rgba(79, 142, 247, 0.08)' : 'rgba(212, 160, 48, 0.08)'
                    }}>
                      {isProfessional ? 'Pro' : 'Perso'}
                    </span>
                    
                    <span style={styles.dateLabel}>
                      <Clock size={12} style={{ marginRight: 4 }} />
                      {new Date(n.created_at).toLocaleDateString('fr-FR', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                  </div>
                </div>

                <p style={styles.noteContent}>{n.content}</p>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '30px',
    height: '100%',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 24,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: '2.25rem',
    fontWeight: 800,
    color: '#fff',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: '0.95rem',
    color: 'var(--text-secondary)',
  },
  addBtn: {
    display: 'flex',
    alignItems: 'center',
    padding: '10px 18px',
    fontSize: '0.85rem',
  },
  formCard: {
    padding: 24,
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
  },
  formTitle: {
    fontSize: '1.25rem',
    fontWeight: 700,
    color: '#fff',
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 16,
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  label: {
    fontSize: '0.75rem',
    fontWeight: 600,
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
  },
  input: {
    background: 'rgba(0,0,0,0.2)',
    border: '1px solid var(--border-glow)',
    borderRadius: 8,
    padding: '10px 14px',
    color: '#fff',
    outline: 'none',
    fontSize: '0.9rem',
  },
  select: {
    background: 'rgba(0,0,0,0.2)',
    border: '1px solid var(--border-glow)',
    borderRadius: 8,
    padding: '10px 14px',
    color: '#fff',
    outline: 'none',
    fontSize: '0.9rem',
  },
  textarea: {
    background: 'rgba(0,0,0,0.2)',
    border: '1px solid var(--border-glow)',
    borderRadius: 8,
    padding: '10px 14px',
    color: '#fff',
    outline: 'none',
    fontSize: '0.9rem',
    minHeight: '100px',
    resize: 'vertical',
  },
  submitBtn: {
    alignSelf: 'flex-start',
    padding: '12px 24px',
  },
  searchBlock: {
    padding: '12px 18px',
    display: 'flex',
    alignItems: 'center',
  },
  searchInput: {
    background: 'none',
    border: 'none',
    color: '#fff',
    outline: 'none',
    fontSize: '0.95rem',
    width: '100%',
  },
  notesList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  noteCard: {
    padding: 20,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  noteHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid rgba(255,255,255,0.03)',
    paddingBottom: 10,
    flexWrap: 'wrap',
    gap: 10,
  },
  contactDetails: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: '50%',
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid var(--border-glow)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
  },
  contactName: {
    fontSize: '0.9rem',
    fontWeight: 700,
    color: '#fff',
  },
  contactCompany: {
    fontSize: '0.8rem',
    color: 'var(--text-muted)',
  },
  metaRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  contextBadge: {
    fontSize: '0.65rem',
    fontWeight: 700,
    textTransform: 'uppercase',
    padding: '2px 6px',
    borderRadius: 4,
  },
  dateLabel: {
    fontSize: '0.725rem',
    color: 'var(--text-muted)',
    display: 'inline-flex',
    alignItems: 'center',
  },
  noteContent: {
    fontSize: '0.85rem',
    color: 'var(--text-secondary)',
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    border: '1.5px dashed var(--border-glow)',
    borderRadius: 16,
    color: 'var(--text-muted)',
  }
};
