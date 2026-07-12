import React, { useState, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { Tag as TagIcon, Plus, X, Folder } from 'lucide-react';

interface TagsPageProps {
  tags: any[];
  spaces: any[];
  user: any;
  onRefreshData: () => Promise<void>;
}

export const TagsPage: React.FC<TagsPageProps> = ({
  tags,
  spaces,
  user: _user,
  onRefreshData
}) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [loading, setLoading] = useState(false);

  // Form Fields
  const [name, setName] = useState('');
  const [category, setCategory] = useState<'industrie' | 'relation' | 'contexte' | 'statut'>('industrie');
  const [spaceId, setSpaceId] = useState(spaces[0]?.id || '');

  // Group tags by category
  const groupedTags = useMemo(() => {
    const groups = {
      industrie: [] as any[],
      relation: [] as any[],
      contexte: [] as any[],
      statut: [] as any[]
    };

    tags.forEach(t => {
      const cat = t.category as keyof typeof groups;
      if (groups[cat]) {
        groups[cat].push(t);
      } else {
        // Fallback for custom or missing categories
        groups.industrie.push(t);
      }
    });

    return groups;
  }, [tags]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !spaceId || !category) {
      alert("Veuillez renseigner le nom, la catégorie et la galaxie.");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.from('tags').insert({
        name: name.trim(),
        category: category,
        space_id: spaceId
      });

      if (error) throw error;

      // Reset form
      setName('');
      setCategory('industrie');
      setShowAddForm(false);
      
      await onRefreshData();
    } catch (err: any) {
      console.error(err);
      alert(`Erreur d'insertion : ${err.message || 'Impossible d\'ajouter le tag.'}`);
    } finally {
      setLoading(false);
    }
  };

  const getCategoryLabel = (cat: string) => {
    switch (cat) {
      case 'industrie': return '🏷️ Secteur / Compétence (Liaisons Actives)';
      case 'relation': return '👥 Type de Relation (Liaisons Actives)';
      case 'contexte': return '📡 Source / Contexte (Métadonnées)';
      case 'statut': return '⏳ Statut d\'Activité (Veille)';
      default: return 'Tag';
    }
  };

  const getCategoryColor = (cat: string) => {
    switch (cat) {
      case 'industrie': return 'var(--neon-purple)';
      case 'relation': return 'var(--neon-blue)';
      case 'contexte': return 'var(--neon-green)';
      case 'statut': return 'var(--neon-yellow)';
      default: return 'var(--text-muted)';
    }
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Tags & Catégories</h1>
          <p style={styles.subtitle}>Organisez les critères sémantiques et filtres de vos réseaux</p>
        </div>
        <button 
          onClick={() => {
            setShowAddForm(!showAddForm);
            setSpaceId(spaces[0]?.id || '');
          }} 
          className="btn-primary" 
          style={styles.addBtn}
        >
          {showAddForm ? <X size={16} style={{ marginRight: 6 }} /> : <Plus size={16} style={{ marginRight: 6 }} />}
          {showAddForm ? 'Fermer' : 'Nouveau Tag'}
        </button>
      </div>

      {/* Add Tag Form */}
      {showAddForm && (
        <form onSubmit={handleSubmit} className="glass-card glow-active" style={styles.formCard}>
          <h3 style={styles.formTitle}>Créer un nouveau tag</h3>
          <div style={styles.formGrid}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Nom du Tag *</label>
              <input 
                type="text" 
                value={name} 
                onChange={(e) => setName(e.target.value)} 
                required 
                placeholder="Ex: SaaS, Investisseur, VIP, Relancé..."
                style={styles.input} 
              />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Catégorie fonctionnelle *</label>
              <select 
                value={category} 
                onChange={(e) => setCategory(e.target.value as any)} 
                required 
                style={styles.select}
              >
                <option value="industrie">Secteur / Compétence (industrie)</option>
                <option value="relation">Type de Relation (relation)</option>
                <option value="contexte">Source / Canal (contexte)</option>
                <option value="statut">Statut d'Activité (statut)</option>
              </select>
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Galaxie / Cercle d'affectation *</label>
              <select 
                value={spaceId} 
                onChange={(e) => setSpaceId(e.target.value)} 
                required 
                style={styles.select}
              >
                <option value="">Sélectionner une galaxie...</option>
                {spaces.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>
          <button type="submit" disabled={loading} className="btn-primary" style={styles.submitBtn}>
            {loading ? 'Création...' : 'Créer le Tag 🚀'}
          </button>
        </form>
      )}

      {/* Categories sections */}
      <div style={styles.categoriesList}>
        {(Object.keys(groupedTags) as Array<keyof typeof groupedTags>).map(catKey => {
          const categoryTags = groupedTags[catKey];
          const color = getCategoryColor(catKey);

          return (
            <div key={catKey} className="glass-panel" style={styles.categoryPanel}>
              <div style={{ ...styles.panelHeader, borderBottom: `2px solid ${color}` }}>
                <Folder size={16} color={color} style={{ marginRight: 8 }} />
                <h3 style={styles.panelTitle}>{getCategoryLabel(catKey)}</h3>
              </div>

              <div style={styles.tagsContainer}>
                {categoryTags.length === 0 ? (
                  <span style={styles.emptyText}>Aucun tag dans cette catégorie.</span>
                ) : (
                  categoryTags.map(t => {
                    const spaceName = spaces.find(s => s.id === t.space_id)?.name || 'Espace global';
                    return (
                      <div 
                        key={t.id} 
                        style={{ 
                          ...styles.tagBadge, 
                          borderColor: color, 
                          background: `rgba(${catKey === 'industrie' ? '159, 97, 232' : catKey === 'relation' ? '79, 142, 247' : catKey === 'contexte' ? '48, 192, 96' : '212, 160, 48'}, 0.06)`
                        }}
                      >
                        <TagIcon size={12} color={color} style={{ marginRight: 6 }} />
                        <span style={styles.tagName}>{t.name}</span>
                        <span style={styles.tagSpace}>({spaceName})</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
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
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
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
  submitBtn: {
    alignSelf: 'flex-start',
    padding: '12px 24px',
  },
  categoriesList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
  },
  categoryPanel: {
    padding: 20,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  panelHeader: {
    display: 'flex',
    alignItems: 'center',
    paddingBottom: 8,
  },
  panelTitle: {
    fontSize: '0.95rem',
    fontWeight: 700,
    color: '#fff',
  },
  tagsContainer: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 10,
  },
  tagBadge: {
    border: '1px solid',
    borderRadius: '8px',
    padding: '6px 12px',
    display: 'flex',
    alignItems: 'center',
    cursor: 'default',
  },
  tagName: {
    fontSize: '0.825rem',
    fontWeight: 600,
    color: '#fff',
  },
  tagSpace: {
    fontSize: '0.7rem',
    color: 'var(--text-muted)',
    marginLeft: 6,
  },
  emptyText: {
    fontSize: '0.8rem',
    color: 'var(--text-muted)',
    fontStyle: 'italic',
  }
};
