import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
// Mistral API helper for AIInput
const callMistralForAIInput = async (apiKey: string, prompt: string): Promise<string> => {
  const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'mistral-small-latest',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    }),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Mistral API error ${response.status}: ${errText}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
};


interface AIInputProps {
  contacts: any[];
  onRefreshData: () => Promise<void>;
  user: any;
  selectedSpaceId: string | null;
  spaces: any[];
}

export const AIInput: React.FC<AIInputProps> = ({
  contacts,
  onRefreshData,
  user,
  selectedSpaceId,
  spaces
}) => {
  const [activeTab, setActiveTab] = useState<'note' | 'extract'>('note');
  const [inputText, setInputText] = useState('');
  const [selectedContactId, setSelectedContactId] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any>(null);

  // Find target space (fallback to user's first personal space if none selected)
  const getTargetSpaceId = () => {
    if (selectedSpaceId) return selectedSpaceId;
    const personalSpace = spaces.find(s => s.type === 'personal');
    return personalSpace?.id || (spaces.length > 0 ? spaces[0].id : null);
  };

  // 1. Structure a note for an existing contact using Mistral Pro
  const handleStructureNote = async () => {
    if (!selectedContactId) {
      alert("Veuillez sélectionner un contact.");
      return;
    }
    if (!inputText.trim() || inputText.length < 5) {
      alert("Veuillez saisir une note plus longue.");
      return;
    }

    setLoading(true);
    setResults(null);

    try {
      const apiKey = import.meta.env.VITE_MISTRAL_API_KEY;
      if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY_HERE') {
        throw new Error("Clé Mistral API manquante dans .env.local");
      }

      const contact = contacts.find(c => c.id === selectedContactId);
      
      const prompt = `Tu es l'assistant IA de Circl Web. Un utilisateur vient de saisir une note brute (dictée ou résumé rapide) concernant un contact.
Analyse cette note et structure-la proprement.

Données du contact actuel :
- Nom : ${contact?.first_name} ${contact?.last_name}
- Entreprise actuelle : ${contact?.company || 'Inconnue'}
- Poste actuel : ${contact?.job_title || 'Inconnu'}

Note brute saisie :
\"\"\"
${inputText}
\"\"\"

Retourne un objet JSON valide avec :
{
  "cleanNote": "La note rédigée de manière propre, concise, professionnelle, à la première personne. Conserve les faits, élimine les hésitations.",
  "fieldUpdates": {
    "company": "nouveau nom d'entreprise mentionné (null si aucun changement)",
    "job_title": "nouveau poste mentionné (null si aucun)",
    "location": "nouvelle localisation mentionnée (null si aucune)",
    "bio": "courte bio mise à jour si de nouvelles informations de fond sont mentionnées (null si aucun changement)"
  },
  "suggestedTags": ["liste de tags courts pertinents déduits de la note, ex: Dev, Client, À recontacter"]
}

Réponds uniquement avec le JSON.`;

      let text = await callMistralForAIInput(apiKey, prompt);
      text = text.replace(/```json\n?/gi, '').replace(/```\n?/gi, '').trim();
      const data = JSON.parse(text);

      // 1. Insert note in Supabase
      const { error: noteError } = await supabase
        .from('notes')
        .insert({
          contact_id: selectedContactId,
          author_id: user.id,
          content: data.cleanNote,
          context: 'professional',
        });

      if (noteError) throw noteError;

      // 2. Perform contact field updates if suggested
      const updates: any = {};
      if (data.fieldUpdates.company) updates.company = data.fieldUpdates.company;
      if (data.fieldUpdates.job_title) updates.job_title = data.fieldUpdates.job_title;
      if (data.fieldUpdates.location) updates.location = data.fieldUpdates.location;
      if (data.fieldUpdates.bio) updates.bio = data.fieldUpdates.bio;

      if (Object.keys(updates).length > 0) {
        await supabase
          .from('contacts')
          .update(updates)
          .eq('id', selectedContactId);
      }

      // 3. Link tags
      const targetSpace = getTargetSpaceId();
      for (const tagName of data.suggestedTags || []) {
        // Find or create tag
        let { data: tag } = await supabase
          .from('tags')
          .select('id')
          .eq('space_id', targetSpace)
          .eq('name', tagName)
          .maybeSingle();

        if (!tag) {
          const { data: newTag } = await supabase
            .from('tags')
            .insert({
              space_id: targetSpace,
              name: tagName,
              category: 'relation',
              color_hex: '#4F8EF7'
            })
            .select('id')
            .single();
          tag = newTag;
        }

        if (tag) {
          await supabase
            .from('contact_tags')
            .insert({
              contact_id: selectedContactId,
              tag_id: tag.id,
              tagged_by: user.id
            })
            .maybeSingle();
        }
      }

      setResults({
        type: 'note',
        success: true,
        note: data.cleanNote,
        updates: updates,
        tags: data.suggestedTags
      });

      setInputText('');
      await onRefreshData();
    } catch (err: any) {
      console.error(err);
      alert(err.message || "Une erreur est survenue lors de l'analyse.");
    } finally {
      setLoading(false);
    }
  };

  // 2. Extract multiple new contacts from raw text block
  const handleExtractContacts = async () => {
    if (!inputText.trim() || inputText.length < 15) {
      alert("Veuillez copier un texte brut plus long (e.g. signature de mail, descriptif de réunion, etc.).");
      return;
    }

    setLoading(true);
    setResults(null);

    try {
      const apiKey = import.meta.env.VITE_MISTRAL_API_KEY;
      if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY_HERE') {
        throw new Error("Clé Mistral API manquante dans .env.local");
      }

      const prompt = `Tu es un expert en extraction de contacts (parsing).
Analyse le texte brut ci-dessous et extrais TOUS les contacts professionnels présents (personnes physiques avec leurs détails).

Texte brut :
\"\"\"
${inputText}
\"\"\"

Retourne un objet JSON avec cette structure précise :
{
  "contacts": [
    {
      "first_name": "Prénom (requis)",
      "last_name": "Nom (requis)",
      "email": "email ou null",
      "phone": "téléphone ou null",
      "company": "entreprise ou null",
      "job_title": "poste ou null",
      "location": "ville/pays ou null",
      "industry": "secteur déduit (ex: Tech, Finance, Immobilier) ou null",
      "bio": "courte phrase décrivant ce qu'il fait basé sur le texte"
    }
  ]
}

Si aucun contact n'est présent, retourne {"contacts": []}. Réponds uniquement avec le JSON.`;

      let text = await callMistralForAIInput(apiKey, prompt);
      text = text.replace(/```json\n?/gi, '').replace(/```\n?/gi, '').trim();
      const data = JSON.parse(text);

      setResults({
        type: 'extract',
        contacts: data.contacts || []
      });
    } catch (err: any) {
      console.error(err);
      alert(err.message || "Erreur de parsing.");
    } finally {
      setLoading(false);
    }
  };

  // Save the extracted contacts to Supabase
  const handleSaveExtractedContacts = async () => {
    if (!results || !results.contacts || results.contacts.length === 0) return;

    setLoading(true);
    const targetSpace = getTargetSpaceId();

    let successCount = 0;
    let errorCount = 0;

    // Helper to clean up false values to actual nulls
    const cleanToNull = (val: string | null | undefined) => {
      if (!val) return null;
      const clean = val.trim().toLowerCase();
      if (clean === '' || clean === 'null' || clean === 'n/a' || clean === 'non renseigné' || clean === 'inconnu') return null;
      return val.trim();
    };

    try {
      for (const c of results.contacts) {
        const row = {
          space_id: targetSpace,
          owner_id: user.id,
          first_name: c.first_name,
          last_name: c.last_name,
          email: cleanToNull(c.email),
          phone: cleanToNull(c.phone),
          company: cleanToNull(c.company),
          job_title: cleanToNull(c.job_title),
          location: cleanToNull(c.location),
          industry: cleanToNull(c.industry) || 'Tech',
          bio: cleanToNull(c.bio) || '',
          source: 'enrichment'
        };

        const { error } = await supabase.from('contacts').insert(row);
        
        if (error) {
          console.error(`Erreur d'insertion pour ${c.first_name} ${c.last_name}:`, error.message);
          errorCount++;
        } else {
          successCount++;
        }
      }

      if (successCount > 0) {
        alert(`${successCount} contact(s) ajouté(s) avec succès ! ${errorCount > 0 ? `(${errorCount} ignorés car doublons)` : ''}`);
        setResults(null);
        setInputText('');
        await onRefreshData();
      } else {
        alert(`Aucun contact ajouté. Il se peut qu'ils existent déjà (doublons).`);
      }
    } catch (err: any) {
      console.error(err);
      alert("Erreur critique lors de la sauvegarde : " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      {/* Background space elements */}
      <div className="bg-grid"></div>
      <div className="bg-stars"></div>

      {/* Header */}
      <div>
        <h1 style={styles.title}>Ingestion Rapide IA</h1>
        <p style={styles.subtitle}>Enregistrez des notes vocales ou extrayez des contacts en collant du texte brut</p>
      </div>

      {/* Mode Selector */}
      <div style={styles.tabs}>
        <button 
          onClick={() => { setActiveTab('note'); setResults(null); }} 
          style={{ ...styles.tabBtn, ...(activeTab === 'note' ? styles.tabBtnActive : {}) }}
        >
          
          Ajouter une Note (Contact existant)
        </button>
        <button 
          onClick={() => { setActiveTab('extract'); setResults(null); }} 
          style={{ ...styles.tabBtn, ...(activeTab === 'extract' ? styles.tabBtnActive : {}) }}
        >
          
          Extraire des Contacts (Texte brut)
        </button>
      </div>

      {/* Main input block */}
      <div className="glass-card" style={styles.card}>
        {activeTab === 'note' ? (
          <div style={styles.form}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Sélectionner l'étoile (Contact)</label>
              <select
                value={selectedContactId}
                onChange={(e) => setSelectedContactId(e.target.value)}
                style={styles.select}
              >
                <option value="">-- Choisir un contact --</option>
                {contacts
                  .sort((a, b) => a.first_name.localeCompare(b.first_name))
                  .map(c => (
                    <option key={c.id} value={c.id}>
                      {c.first_name} {c.last_name} {c.company ? `(${c.company})` : ''}
                    </option>
                  ))
                }
              </select>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Texte de l'échange ou dictée brute</label>
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Ex: J'ai déjeuné avec Bob. Il m'a annoncé qu'il a quitté son entreprise FreeCode. Il travaille désormais comme Architecte Cloud chez AWS à Paris. Il cherche des dev et il est super intéressé par nos projets."
                rows={6}
                style={styles.textarea}
              />
            </div>

            <button 
              onClick={handleStructureNote} 
              disabled={loading}
              className="btn-primary" 
              style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, padding: 14 }}
            >
              
              {loading ? 'Analyse IA...' : 'Analyser et Enregistrer'}
            </button>
          </div>
        ) : (
          <div style={styles.form}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Texte brut à parser (Signatures, Mails, Profils LinkedIn)</label>
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Collez ici des informations brutes. Exemple :&#10;Alice Martin&#10;CEO de GreenTech Solutions&#10;alice@greentech.io - 06 12 34 56 78&#10;Paris, France"
                rows={8}
                style={styles.textarea}
              />
            </div>

            <button 
              onClick={handleExtractContacts} 
              disabled={loading}
              className="btn-primary" 
              style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, padding: 14 }}
            >
              
              {loading ? 'Extraction en cours...' : 'Extraire les Contacts'}
            </button>
          </div>
        )}
      </div>

      {/* Results Display */}
      {results && results.type === 'note' && (
        <div className="glass-card" style={styles.resultsCard}>
          <div style={styles.resultsHeader}>
            
            <h3 style={{ fontSize: '1.1rem' }}>Note enregistrée et analysée avec succès !</h3>
          </div>
          <div style={styles.resultDetails}>
            <div style={styles.resultBlock}>
              <span style={styles.resultBlockTitle}>Note reformulée :</span>
              <p style={styles.resultText}>{results.note}</p>
            </div>
            
            {Object.keys(results.updates).length > 0 && (
              <div style={styles.resultBlock}>
                <span style={{ ...styles.resultBlockTitle, color: '#fff' }}>Changements appliqués au contact :</span>
                <div style={styles.updatesList}>
                  {Object.entries(results.updates).map(([key, val]) => (
                    <div key={key} style={styles.updateItem}>
                      <span style={styles.updateKey}>{key} :</span>
                      <span style={styles.updateVal}>{val as string}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {results.tags && results.tags.length > 0 && (
              <div style={styles.resultBlock}>
                <span style={styles.resultBlockTitle}>Tags associés :</span>
                <div style={styles.tagsRow}>
                  {results.tags.map((t: string, idx: number) => (
                    <span key={idx} style={styles.tagBadge}>{t}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {results && results.type === 'extract' && (
        <div className="glass-card" style={styles.resultsCard}>
          <div style={styles.resultsHeader}>
            
            <h3 style={{ fontSize: '1.1rem' }}>Contacts identifiés par Mistral ({results.contacts.length})</h3>
          </div>

          {results.contacts.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', padding: 16 }}>Aucun profil n'a pu être extrait. Réessayez avec un texte plus riche.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 12 }}>
              <div style={styles.extractedGrid}>
                {results.contacts.map((c: any, idx: number) => (
                  <div key={idx} style={styles.extractedCard}>
                    <div style={styles.extractedCardHeader}>
                      
                      <span style={{ fontWeight: 700, color: '#fff' }}>{c.first_name} {c.last_name}</span>
                    </div>
                    <div style={styles.extractedDetails}>
                      {c.company && (
                        <div style={styles.extDetail}>
                          
                          <span>{c.job_title || 'Poste'} chez <b>{c.company}</b></span>
                        </div>
                      )}
                      {c.location && (
                        <div style={styles.extDetail}>
                          
                          <span>{c.location}</span>
                        </div>
                      )}
                      {c.email && (
                        <div style={styles.extDetail}>
                          
                          <span>{c.email}</span>
                        </div>
                      )}
                      {c.bio && (
                        <p style={styles.extractedBio}>"{c.bio}"</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div style={styles.actionsRow}>
                <button onClick={handleSaveExtractedContacts} className="btn-primary" style={{ flexGrow: 1 }}>
                  Valider et Enregistrer dans la base de données
                </button>
                <button onClick={() => setResults(null)} className="btn-secondary">
                  Annuler
                </button>
              </div>
            </div>
          )}
        </div>
      )}
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
    position: 'relative',
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
  tabs: {
    display: 'flex',
    gap: 12,
    borderBottom: '1px solid var(--border-glow)',
    paddingBottom: 12,
  },
  tabBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-secondary)',
    padding: '10px 16px',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: '0.9rem',
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    transition: 'var(--transition-smooth)',
  },
  tabBtnActive: {
    background: 'rgba(255, 255, 255, 0.05)',
    color: '#fff',
  },
  card: {
    padding: 30,
    width: '100%',
    maxWidth: 800,
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  label: {
    fontSize: '0.8rem',
    fontWeight: 700,
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  select: {
    background: 'rgba(0,0,0,0.2)',
    border: '1px solid var(--border-glow)',
    borderRadius: 8,
    padding: '12px 16px',
    color: '#fff',
    fontSize: '0.95rem',
    outline: 'none',
  },
  textarea: {
    background: 'rgba(0,0,0,0.2)',
    border: '1px solid var(--border-glow)',
    borderRadius: 8,
    padding: 16,
    color: '#fff',
    fontSize: '0.95rem',
    outline: 'none',
    resize: 'vertical',
  },
  resultsCard: {
    padding: 24,
    width: '100%',
    maxWidth: 800,
    marginTop: 10,
  },
  resultsHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    borderBottom: '1px solid var(--border-glow)',
    paddingBottom: 12,
    color: '#fff',
  },
  resultDetails: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    marginTop: 16,
  },
  resultBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  resultBlockTitle: {
    fontSize: '0.75rem',
    fontWeight: 700,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
  },
  resultText: {
    fontSize: '0.9rem',
    color: 'var(--text-secondary)',
    lineHeight: 1.5,
    background: 'rgba(0,0,0,0.1)',
    padding: 12,
    borderRadius: 8,
  },
  updatesList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    background: 'rgba(79, 142, 247, 0.03)',
    border: '1px solid rgba(79, 142, 247, 0.1)',
    padding: 12,
    borderRadius: 8,
  },
  updateItem: {
    display: 'flex',
    gap: 8,
    fontSize: '0.85rem',
  },
  updateKey: {
    fontWeight: 600,
    color: 'var(--text-secondary)',
    textTransform: 'capitalize',
  },
  updateVal: {
    color: '#fff',
  },
  tagsRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
  },
  tagBadge: {
    background: 'rgba(159, 97, 232, 0.1)',
    border: '1px solid rgba(159, 97, 232, 0.2)',
    color: '#fff',
    padding: '4px 10px',
    borderRadius: 99,
    fontSize: '0.75rem',
    fontWeight: 600,
  },
  extractedGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: 16,
  },
  extractedCard: {
    background: 'rgba(255, 255, 255, 0.01)',
    border: '1px solid var(--border-glow)',
    borderRadius: 10,
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  extractedCardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    borderBottom: '1px solid var(--border-glow)',
    paddingBottom: 8,
  },
  extractedDetails: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  extDetail: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: '0.8rem',
    color: 'var(--text-secondary)',
  },
  extractedBio: {
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
    fontStyle: 'italic',
    marginTop: 4,
  },
  actionsRow: {
    display: 'flex',
    gap: 14,
    marginTop: 16,
  },
};
export default AIInput;
