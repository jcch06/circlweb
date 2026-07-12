import React, { useState, useMemo, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { detectContactSynergies, enrichProfileFromScraping, autoEnrichContact, isGeminiConfigured } from '../lib/gemini';
import type { ContactSynergy } from '../lib/gemini';
import { 
  Users, 
  Plus, 
  X, 
  Search, 
  MapPin, 
  Briefcase, 
  Tag, 
  Mail, 
  Phone, 
  ExternalLink, 
  Sparkles, 
  Orbit, 
  Zap, 
  Key, 
  ArrowRight,
  Clock,
  Globe,
  Layers
} from 'lucide-react';

interface ContactsPageProps {
  contacts: any[];
  spaces: any[];
  notes: any[];
  tags: any[];
  contactTags: any[];
  user: any;
  selectedSpaceId: string | null;
  onRefreshData: () => Promise<void>;
}

export const ContactsPage: React.FC<ContactsPageProps> = ({
  contacts,
  spaces,
  notes,
  tags,
  contactTags,
  user,
  selectedSpaceId,
  onRefreshData
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);

  // Form Fields for New Contact
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [company, setCompany] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [industry, setIndustry] = useState('');
  const [location, setLocation] = useState('');
  const [bio, setBio] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [linkedin, setLinkedin] = useState('');
  const [spaceId, setSpaceId] = useState(selectedSpaceId || (spaces[0]?.id || ''));

  // Drawer States
  const [enriching, setEnriching] = useState(false);
  const [scrapedText, setScrapedText] = useState('');
  const [showEnrichForm, setShowEnrichForm] = useState(false);

  // Bulk Enrichment States
  const [bulkEnriching, setBulkEnriching] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0, current: '', errors: 0 });
  const [bulkEnrichSpaceId, setBulkEnrichSpaceId] = useState('');
  
  // Synergy States
  const [synergies, setSynergies] = useState<ContactSynergy[]>([]);
  const [loadingSynergies, setLoadingSynergies] = useState(false);
  const [synergyError, setSynergyError] = useState<string | null>(null);
  const [hasSearchedSynergies, setHasSearchedSynergies] = useState(false);
  // Galaxy Merge Invitation States
  const [inviteSpaceId, setInviteSpaceId] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [sendingInvite, setSendingInvite] = useState(false);

  // Galaxy Membership States
  const [selectedSpaces, setSelectedSpaces] = useState<string[]>([]);
  const [updatingSpaces, setUpdatingSpaces] = useState(false);

  // Bulk Assignment States
  const [bulkSelectedIds, setBulkSelectedIds] = useState<string[]>([]);
  const [bulkTargetSpaceId, setBulkTargetSpaceId] = useState('');
  const [bulkLoading, setBulkLoading] = useState(false);

  const handleBulkAddToSpace = async () => {
    if (!bulkTargetSpaceId) {
      alert("Veuillez sélectionner un cercle cible.");
      return;
    }
    setBulkLoading(true);
    try {
      const selectedContacts = contacts.filter(c => bulkSelectedIds.includes(c.id));
      
      // Fetch existing contacts in the target space to prevent duplicates
      const { data: targetContacts, error: fetchErr } = await supabase
        .from('contacts')
        .select('first_name, last_name')
        .eq('space_id', bulkTargetSpaceId);
      if (fetchErr) throw fetchErr;

      const existingNames = new Set(
        (targetContacts || []).map((tc: any) => `${tc.first_name.toLowerCase()}|${tc.last_name.toLowerCase()}`)
      );

      let insertCount = 0;
      for (const contact of selectedContacts) {
        const key = `${contact.first_name.toLowerCase()}|${contact.last_name.toLowerCase()}`;
        if (!existingNames.has(key)) {
          const { error } = await supabase.from('contacts').insert({
            space_id: bulkTargetSpaceId,
            owner_id: user.id,
            first_name: contact.first_name,
            last_name: contact.last_name,
            company: contact.company,
            job_title: contact.job_title,
            industry: contact.industry,
            location: contact.location,
            bio: contact.bio,
            email: contact.email,
            phone: contact.phone,
            linkedin: contact.linkedin,
            ai_context: contact.ai_context,
            source: contact.source || 'manual'
          });
          if (error) throw error;
          insertCount++;
        }
      }

      alert(`${insertCount} contact(s) ajouté(s) à la galaxie cible !`);
      setBulkSelectedIds([]);
      await onRefreshData();
    } catch (err: any) {
      console.error(err);
      alert(`Erreur lors de l'ajout en masse : ${err.message || 'Impossible d\'ajouter les contacts.'}`);
    } finally {
      setBulkLoading(false);
    }
  };

  const handleBulkRemoveFromSpace = async () => {
    if (!bulkTargetSpaceId) {
      alert("Veuillez sélectionner un cercle cible.");
      return;
    }
    if (!window.confirm("Êtes-vous sûr de vouloir retirer les contacts sélectionnés de cette Galaxie ?")) {
      return;
    }
    setBulkLoading(true);
    try {
      const selectedContacts = contacts.filter(c => bulkSelectedIds.includes(c.id));
      
      for (const contact of selectedContacts) {
        const { error } = await supabase
          .from('contacts')
          .delete()
          .eq('space_id', bulkTargetSpaceId)
          .eq('first_name', contact.first_name)
          .eq('last_name', contact.last_name);
        if (error) throw error;
      }

      alert("Contacts retirés de la galaxie cible !");
      setBulkSelectedIds([]);
      await onRefreshData();
    } catch (err: any) {
      console.error(err);
      alert(`Erreur lors du retrait en masse : ${err.message || 'Impossible de retirer les contacts.'}`);
    } finally {
      setBulkLoading(false);
    }
  };

  // Compute team/collaborative spaces
  const teamSpaces = useMemo(() => {
    return spaces.filter(s => s.type === 'team');
  }, [spaces]);

  // Reset synergy search, prefill invitation details, & fetch current galaxy membership when selected contact changes
  useEffect(() => {
    setSynergies([]);
    setLoadingSynergies(false);
    setSynergyError(null);
    setHasSearchedSynergies(false);
    setShowEnrichForm(false);
    setScrapedText('');

    const contact = contacts.find(c => c.id === selectedContactId);
    if (contact) {
      setInviteEmail(contact.email || '');
      // Find all spaces where a contact with same name exists
      const sameNameContacts = contacts.filter(
        c => c.first_name.toLowerCase() === contact.first_name.toLowerCase() && 
             c.last_name.toLowerCase() === contact.last_name.toLowerCase()
      );
      setSelectedSpaces(sameNameContacts.map(c => c.space_id));
    } else {
      setInviteEmail('');
      setSelectedSpaces([]);
    }

    const firstTeamSpace = spaces.find(s => s.type === 'team');
    setInviteSpaceId(firstTeamSpace?.id || '');
  }, [selectedContactId, contacts, spaces]);

  const handleSendMergeInvitation = async () => {
    if (!inviteSpaceId) {
      alert("Veuillez sélectionner un Espace Collaboratif pour y fusionner vos données.");
      return;
    }
    if (!inviteEmail.trim()) {
      alert("Veuillez renseigner l'adresse email de ce contact.");
      return;
    }

    setSendingInvite(true);
    try {
      const { error } = await supabase.from('invitations').insert({
        space_id: inviteSpaceId,
        email: inviteEmail.trim().toLowerCase(),
        invited_by: user.id,
        role: 'member'
      });

      if (error) {
        if (error.code === '23505') {
          throw new Error("Ce contact a déjà été invité dans cet Espace.");
        }
        throw error;
      }

      alert(`Invitation de fusion envoyée avec succès à ${inviteEmail} !`);
    } catch (err: any) {
      console.error(err);
      alert(`Erreur d'envoi : ${err.message || "Impossible d'envoyer l'invitation."}`);
    } finally {
      setSendingInvite(false);
    }
  };

  const handleUpdateContactSpaces = async () => {
    if (!contactDetails) return;
    setUpdatingSpaces(true);
    try {
      // Find current spaces where contact with this name exists
      const currentSpaces = contacts
        .filter(c => c.first_name.toLowerCase() === contactDetails.first_name.toLowerCase() && 
                     c.last_name.toLowerCase() === contactDetails.last_name.toLowerCase())
        .map(c => c.space_id);

      // 1. Add to new spaces
      const spacesToAdd = selectedSpaces.filter(sid => !currentSpaces.includes(sid));
      for (const spaceId of spacesToAdd) {
        const { error } = await supabase.from('contacts').insert({
          space_id: spaceId,
          owner_id: user.id,
          first_name: contactDetails.first_name,
          last_name: contactDetails.last_name,
          company: contactDetails.company,
          job_title: contactDetails.job_title,
          industry: contactDetails.industry,
          location: contactDetails.location,
          bio: contactDetails.bio,
          email: contactDetails.email,
          phone: contactDetails.phone,
          linkedin: contactDetails.linkedin,
          ai_context: contactDetails.ai_context,
          source: 'manual'
        });
        if (error) throw error;
      }

      // 2. Remove from unchecked spaces
      const spacesToRemove = currentSpaces.filter(sid => !selectedSpaces.includes(sid));
      for (const spaceId of spacesToRemove) {
        const { error } = await supabase
          .from('contacts')
          .delete()
          .eq('space_id', spaceId)
          .eq('first_name', contactDetails.first_name)
          .eq('last_name', contactDetails.last_name);
        if (error) throw error;
      }

      alert("Liaisons avec les Galaxies mises à jour !");
      await onRefreshData();
      
      // If we removed the contact from the current space, close the drawer
      if (spacesToRemove.includes(contactDetails.space_id)) {
        setSelectedContactId(null);
      }
    } catch (err: any) {
      console.error(err);
      alert(`Erreur lors de la mise à jour : ${err.message || 'Impossible de modifier les galaxies du contact.'}`);
    } finally {
      setUpdatingSpaces(false);
    }
  };
  // Compute Selected Contact details
  const contactDetails = useMemo(() => {
    if (!selectedContactId) return null;
    const contact = contacts.find(c => c.id === selectedContactId);
    if (!contact) return null;

    const contactNotes = notes.filter(n => n.contact_id === contact.id);
    const contactTagsRows = contactTags.filter(ct => ct.contact_id === contact.id);
    const contactTagsList = tags.filter(t => contactTagsRows.some(ctr => ctr.tag_id === t.id));
    
    return {
      ...contact,
      notes: contactNotes,
      tags: contactTagsList
    };
  }, [selectedContactId, contacts, notes, tags, contactTags]);

  // Bulk enrich contacts via Gemini AI directly (no Edge Function needed)
  const handleBulkEnrich = async () => {
    // Filter by selected space if specified, otherwise all contacts
    const pool = bulkEnrichSpaceId
      ? contacts.filter(c => c.space_id === bulkEnrichSpaceId)
      : contacts;

    // Only enrich contacts that haven't been enriched yet
    const toEnrich = pool.filter(c => !c.ai_context && !c.bio);

    if (toEnrich.length === 0) {
      alert('Tous les contacts de cette sélection ont déjà été enrichis !');
      return;
    }

    setBulkEnriching(true);
    setBulkProgress({ done: 0, total: toEnrich.length, current: '', errors: 0 });

    let errorCount = 0;
    let successCount = 0;

    for (let i = 0; i < toEnrich.length; i++) {
      const c = toEnrich[i];
      setBulkProgress({ done: i, total: toEnrich.length, current: `${c.first_name} ${c.last_name}`, errors: errorCount });
      try {
        const result = await autoEnrichContact({
          first_name: c.first_name,
          last_name: c.last_name,
          company: c.company,
          job_title: c.job_title,
          industry: c.industry,
          bio: c.bio,
          location: c.location
        });

        // Save enrichment results back to Supabase
        await supabase.from('contacts').update({
          industry: result.industry || c.industry,
          bio: result.bio || c.bio,
          ai_context: result.aiContext,
          enriched_at: new Date().toISOString()
        }).eq('id', c.id);

        successCount++;
      } catch (err) {
        errorCount++;
        console.warn(`Enrichissement échoué pour ${c.first_name} ${c.last_name}:`, err);
      }
      // Delay between calls to respect Gemini rate limits
      await new Promise(resolve => setTimeout(resolve, 1500));
    }

    setBulkProgress({ done: toEnrich.length, total: toEnrich.length, current: '', errors: errorCount });
    await onRefreshData();
    setBulkEnriching(false);
    alert(`✅ Enrichissement terminé !\n${successCount} contact(s) enrichis.${errorCount > 0 ? `\n⚠️ ${errorCount} échec(s).` : ''}`);
  };

  // Filter contacts by active space & search term
  const filteredContacts = useMemo(() => {
    let list = selectedSpaceId
      ? contacts.filter(c => c.space_id === selectedSpaceId)
      : contacts;

    if (searchTerm.trim() !== '') {
      const term = searchTerm.toLowerCase();
      list = list.filter(
        c =>
          `${c.first_name} ${c.last_name}`.toLowerCase().includes(term) ||
          (c.company && c.company.toLowerCase().includes(term)) ||
          (c.job_title && c.job_title.toLowerCase().includes(term))
      );
    }
    return list;
  }, [contacts, selectedSpaceId, searchTerm]);




  // Calculate direct network connections for the selected contact (sharing company or tags)
  const directConnections = useMemo(() => {
    if (!contactDetails) return [];

    const linkTagIds = new Set(
      tags
        .filter(t => t.category !== 'contexte' && t.category !== 'statut')
        .map(t => t.id)
    );

    const targetContactTags = contactTags.filter(ct => ct.contact_id === contactDetails.id);
    const targetTagIds = new Set(targetContactTags.filter(ct => linkTagIds.has(ct.tag_id)).map(ct => ct.tag_id));

    return contacts
      .filter(c => c.id !== contactDetails.id)
      .map(c => {
        // 1. Shared Company
        const sharedCompany = contactDetails.company && c.company && 
          contactDetails.company.trim().toLowerCase() === c.company.trim().toLowerCase() && 
          contactDetails.company.toLowerCase() !== 'inconnue' && 
          contactDetails.company.toLowerCase() !== 'freelance';

        // 2. Shared High-Value Tags
        const cTags = contactTags.filter(ct => ct.contact_id === c.id && linkTagIds.has(ct.tag_id)).map(ct => ct.tag_id);
        const sharedTags = cTags.filter(tagId => targetTagIds.has(tagId));
        const hasSharedTag = sharedTags.length > 0;

        if (sharedCompany) {
          return {
            contact: c,
            reason: `Même entreprise : ${contactDetails.company}`,
            type: 'company'
          };
        } else if (hasSharedTag) {
          const sharedTagNames = tags.filter(t => sharedTags.includes(t.id)).map(t => t.name);
          return {
            contact: c,
            reason: `Compétence/Secteur en commun : ${sharedTagNames.join(', ')}`,
            type: 'tag'
          };
        }
        return null;
      })
      .filter(item => item !== null) as { contact: any; reason: string; type: string }[];
  }, [contactDetails, contacts, contactTags, tags]);

  const handleFetchSynergies = async () => {
    if (!contactDetails) return;
    setLoadingSynergies(true);
    setSynergyError(null);
    try {
      const results = await detectContactSynergies(contactDetails, contacts, notes);
      setSynergies(results);
      setHasSearchedSynergies(true);
    } catch (err: any) {
      console.error(err);
      setSynergyError(err.message || "Une erreur est survenue lors de la détection.");
    } finally {
      setLoadingSynergies(false);
    }
  };

  const handleEnrichProfile = async () => {
    if (!contactDetails) return;
    if (!scrapedText.trim()) {
      alert("Veuillez coller du texte brut.");
      return;
    }

    setEnriching(true);
    try {
      const enrichment = await enrichProfileFromScraping(
        `${contactDetails.first_name} ${contactDetails.last_name}`,
        contactDetails.company || 'Inconnue',
        scrapedText
      );

      // Save enrichment to Supabase
      const { error } = await supabase
        .from('contacts')
        .update({
          bio: enrichment.bio || contactDetails.bio,
          industry: enrichment.industry || contactDetails.industry,
          company_size: enrichment.companySize,
          ai_context: enrichment.aiContext
        })
        .eq('id', contactDetails.id);

      if (error) throw error;

      await onRefreshData();
      alert("Profil enrichi avec succès !");
      setShowEnrichForm(false);
      setScrapedText('');
    } catch (err: any) {
      console.error(err);
      alert(err.message || "Une erreur est survenue lors de l'enrichissement.");
    } finally {
      setEnriching(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim() || !spaceId) {
      alert("Veuillez renseigner le prénom, le nom et la galaxie.");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.from('contacts').insert({
        space_id: spaceId,
        owner_id: user.id,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        company: company.trim() || null,
        job_title: jobTitle.trim() || null,
        industry: industry.trim() || null,
        location: location.trim() || null,
        bio: bio.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        linkedin: linkedin.trim() || null,
        source: 'manual'
      });

      if (error) throw error;

      // Reset form
      setFirstName('');
      setLastName('');
      setCompany('');
      setJobTitle('');
      setIndustry('');
      setLocation('');
      setBio('');
      setEmail('');
      setPhone('');
      setLinkedin('');
      setShowAddForm(false);
      
      await onRefreshData();
    } catch (err: any) {
      console.error(err);
      alert(`Erreur d'insertion : ${err.message || 'Impossible d\'ajouter le contact.'}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      {/* Main Content Area */}
      <div style={{ ...styles.mainLayout, marginRight: contactDetails ? '400px' : '0px' }}>
        {/* Header */}
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>Membres de vos Galaxies</h1>
            <p style={styles.subtitle}>Gérez les étoiles de vos constellations de contacts</p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {!bulkEnriching && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <select
                  value={bulkEnrichSpaceId}
                  onChange={(e) => setBulkEnrichSpaceId(e.target.value)}
                  style={{ ...styles.selectSmall, fontSize: '0.78rem', padding: '8px 10px' }}
                >
                  <option value="">✨ Tous les contacts</option>
                  {spaces.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <button
                  onClick={handleBulkEnrich}
                  className="btn-secondary"
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', fontSize: '0.85rem', whiteSpace: 'nowrap' }}
                >
                  <Sparkles size={15} color="var(--neon-purple)" />
                  Enrichir via IA
                </button>
              </div>
            )}
            <button 
              onClick={() => {
                setShowAddForm(!showAddForm);
                setSpaceId(selectedSpaceId || (spaces[0]?.id || ''));
              }} 
              className="btn-primary" 
              style={styles.addBtn}
            >
              {showAddForm ? <X size={16} style={{ marginRight: 6 }} /> : <Plus size={16} style={{ marginRight: 6 }} />}
              {showAddForm ? 'Fermer' : 'Nouveau Contact'}
            </button>
          </div>
        </div>

        {/* Bulk Enrichment Progress Banner */}
        {bulkEnriching && (
          <div className="glass-card glow-active" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 20, height: 20, flexShrink: 0, border: '2px solid var(--neon-purple)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
              <div style={{ flexGrow: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#fff' }}>
                    Enrichissement IA en cours (Gemini)...
                  </span>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    {bulkProgress.errors > 0 && (
                      <span style={{ fontSize: '0.75rem', color: '#E03E3E' }}>⚠️ {bulkProgress.errors} erreur(s)</span>
                    )}
                    <span style={{ fontSize: '0.8rem', color: 'var(--neon-purple)', fontWeight: 700 }}>
                      {bulkProgress.done} / {bulkProgress.total}
                    </span>
                  </div>
                </div>
                {/* Progress bar */}
                <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 99, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${bulkProgress.total > 0 ? (bulkProgress.done / bulkProgress.total) * 100 : 0}%`,
                    background: 'linear-gradient(90deg, var(--neon-purple), var(--neon-blue))',
                    borderRadius: 99,
                    transition: 'width 0.5s ease',
                  }} />
                </div>
              </div>
            </div>
            {bulkProgress.current && (
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                🤖 Analyse IA : <b style={{ color: '#fff' }}>{bulkProgress.current}</b>
              </span>
            )}
          </div>
        )}

        {/* Add Contact Modal / Section */}
        {showAddForm && (
          <form onSubmit={handleSubmit} className="glass-card glow-active" style={styles.formCard}>
            <h3 style={styles.formTitle}>Ajouter un nouveau contact</h3>
            <div style={styles.formGrid}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Prénom *</label>
                <input 
                  type="text" 
                  value={firstName} 
                  onChange={(e) => setFirstName(e.target.value)} 
                  required 
                  placeholder="Ex: Alice"
                  style={styles.input} 
                />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>Nom *</label>
                <input 
                  type="text" 
                  value={lastName} 
                  onChange={(e) => setLastName(e.target.value)} 
                  required 
                  placeholder="Ex: Martin"
                  style={styles.input} 
                />
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
                    <option key={s.id} value={s.id}>{s.name} ({s.type === 'personal' ? 'Perso' : 'Collab'})</option>
                  ))}
                </select>
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>Entreprise</label>
                <input 
                  type="text" 
                  value={company} 
                  onChange={(e) => setCompany(e.target.value)} 
                  placeholder="Ex: GreenTech"
                  style={styles.input} 
                />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>Poste</label>
                <input 
                  type="text" 
                  value={jobTitle} 
                  onChange={(e) => setJobTitle(e.target.value)} 
                  placeholder="Ex: CEO"
                  style={styles.input} 
                />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>Secteur</label>
                <input 
                  type="text" 
                  value={industry} 
                  onChange={(e) => setIndustry(e.target.value)} 
                  placeholder="Ex: SaaS, ClimateTech"
                  style={styles.input} 
                />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>Email</label>
                <input 
                  type="email" 
                  value={email} 
                  onChange={(e) => setEmail(e.target.value)} 
                  placeholder="Ex: alice@company.com"
                  style={styles.input} 
                />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>Téléphone</label>
                <input 
                  type="text" 
                  value={phone} 
                  onChange={(e) => setPhone(e.target.value)} 
                  placeholder="Ex: +33 6..."
                  style={styles.input} 
                />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>Profil LinkedIn (URL)</label>
                <input 
                  type="text" 
                  value={linkedin} 
                  onChange={(e) => setLinkedin(e.target.value)} 
                  placeholder="Ex: https://linkedin.com/in/..."
                  style={styles.input} 
                />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>Localisation</label>
                <input 
                  type="text" 
                  value={location} 
                  onChange={(e) => setLocation(e.target.value)} 
                  placeholder="Ex: Paris, France"
                  style={styles.input} 
                />
              </div>
              <div style={{ ...styles.formGroup, gridColumn: 'span 2' }}>
                <label style={styles.label}>Biographie / Informations complémentaires</label>
                <textarea 
                  value={bio} 
                  onChange={(e) => setBio(e.target.value)} 
                  placeholder="Renseignez les compétences, les besoins exprimés par ce contact ou son parcours..."
                  style={styles.textarea} 
                />
              </div>
            </div>
            <button type="submit" disabled={loading} className="btn-primary" style={styles.submitBtn}>
              {loading ? 'Création cosmique...' : 'Ajouter le Contact 🚀'}
            </button>
          </form>
        )}
        <div className="glass-card" style={styles.searchBlock}>
          <Search size={18} color="var(--text-secondary)" style={{ marginRight: 10 }} />
          <input 
            type="text" 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Rechercher par nom, entreprise, poste..." 
            style={styles.searchInput}
          />
        </div>

        {/* Selection & Info Bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, padding: '0 4px' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            {filteredContacts.length} contact(s) affiché(s)
          </span>
          {filteredContacts.length > 0 && (
            <button 
              onClick={() => {
                const allIds = filteredContacts.map(c => c.id);
                const allSelected = allIds.every(id => bulkSelectedIds.includes(id));
                if (allSelected) {
                  setBulkSelectedIds(bulkSelectedIds.filter(id => !allIds.includes(id)));
                } else {
                  setBulkSelectedIds([...new Set([...bulkSelectedIds, ...allIds])]);
                }
              }}
              className="btn-primary"
              style={{ fontSize: '0.7rem', padding: '4px 10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-glow)', color: '#fff' }}
            >
              {filteredContacts.map(c => c.id).every(id => bulkSelectedIds.includes(id)) ? 'Tout désélectionner' : 'Tout sélectionner'}
            </button>
          )}
        </div>

        {/* Bulk Action Bar */}
        {bulkSelectedIds.length > 0 && (
          <div className="glass-panel glow-active" style={styles.bulkActionBar}>
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 6 }}>
              🛠️ Action en Masse ({bulkSelectedIds.length} contact(s) sélectionné(s))
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <select 
                value={bulkTargetSpaceId} 
                onChange={(e) => setBulkTargetSpaceId(e.target.value)} 
                style={styles.selectSmallBulk}
              >
                <option value="">Sélectionner une Galaxie cible...</option>
                {spaces.map(s => (
                  <option key={s.id} value={s.id}>{s.name} ({s.type === 'personal' ? 'Perso' : 'Collab'})</option>
                ))}
              </select>
              <button 
                onClick={handleBulkAddToSpace} 
                disabled={bulkLoading || !bulkTargetSpaceId} 
                className="btn-primary" 
                style={{ fontSize: '0.75rem', padding: '6px 12px', background: 'var(--neon-green)', borderColor: 'var(--neon-green)' }}
              >
                Ajouter à la Galaxie 🌌
              </button>
              <button 
                onClick={handleBulkRemoveFromSpace} 
                disabled={bulkLoading || !bulkTargetSpaceId} 
                className="btn-primary" 
                style={{ fontSize: '0.75rem', padding: '6px 12px', background: '#e03e3e', borderColor: '#e03e3e' }}
              >
                Retirer de la Galaxie ❌
              </button>
              <button 
                onClick={() => setBulkSelectedIds([])} 
                className="btn-primary" 
                style={{ fontSize: '0.75rem', padding: '6px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-glow)' }}
              >
                Annuler
              </button>
            </div>
          </div>
        )}

        {/* Grid of Contacts */}
        <div style={styles.contactsGrid}>
          {filteredContacts.length === 0 ? (
            <div style={styles.emptyState}>
              <Users size={32} color="var(--text-muted)" style={{ marginBottom: 8 }} />
              <span>Aucun contact trouvé.</span>
            </div>
          ) : (
            filteredContacts.map(c => {
              const spaceName = spaces.find(s => s.id === c.space_id)?.name || 'Espace inconnu';
              const isSelected = selectedContactId === c.id;
              
              // Color index based on space
              const spaceIndex = spaces.findIndex(s => s.id === c.space_id);
              const colors = ['#4F8EF7', '#9F61E8', '#EC6F8B', '#30C060', '#D4A030', '#E89030'];
              const color = colors[spaceIndex % colors.length] || '#9F61E8';
 
              return (
                <div 
                  key={c.id} 
                  className={`glass-card ${isSelected ? 'glow-active' : ''}`} 
                  style={{ 
                    ...styles.contactCard, 
                    position: 'relative',
                    cursor: 'pointer',
                    borderColor: isSelected ? 'var(--neon-purple)' : 'rgba(255,255,255,0.06)'
                  }}
                  onClick={() => setSelectedContactId(isSelected ? null : c.id)}
                >
                  {/* Checkbox for Bulk Actions */}
                  <input 
                    type="checkbox"
                    checked={bulkSelectedIds.includes(c.id)}
                    onChange={(e) => {
                      e.stopPropagation();
                      if (e.target.checked) {
                        setBulkSelectedIds([...bulkSelectedIds, c.id]);
                      } else {
                        setBulkSelectedIds(bulkSelectedIds.filter(id => id !== c.id));
                      }
                    }}
                    style={styles.cardCheckbox}
                  />
                  <div style={styles.cardHeader}>
                    <div style={{ ...styles.avatar, borderColor: color }}>
                      {c.first_name.charAt(0).toUpperCase()}{c.last_name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h3 style={styles.name}>{c.first_name} {c.last_name}</h3>
                      <span style={styles.spaceBadge}>{spaceName}</span>
                    </div>
                  </div>

                  <div style={styles.detailsList}>
                    {c.company && (
                      <div style={styles.detailItem}>
                        <Briefcase size={14} color="var(--neon-purple)" />
                        <span style={styles.detailText}>{c.job_title || 'Poste inconnu'} @ <b>{c.company}</b></span>
                      </div>
                    )}
                    {c.location && (
                      <div style={styles.detailItem}>
                        <MapPin size={14} color="var(--neon-blue)" />
                        <span style={styles.detailText}>{c.location}</span>
                      </div>
                    )}
                  </div>

                  {c.bio && (
                    <p style={styles.bioText}>
                      {c.bio.length > 120 ? `${c.bio.substring(0, 120)}...` : c.bio}
                    </p>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Slide-out Drawer Panel (rendered inside relative container) */}
      {contactDetails && (
        <div className="glass-sidebar" style={styles.drawer}>
          <div style={styles.drawerHeader}>
            <span style={styles.drawerTitle}>Fiche Contact</span>
            <button onClick={() => setSelectedContactId(null)} style={styles.closeBtn}>
              <X size={18} />
            </button>
          </div>

          <div style={styles.drawerContent}>
            {/* Summary Card */}
            <div style={styles.profileSection}>
              <div style={styles.avatarBig}>
                {contactDetails.first_name.charAt(0).toUpperCase()}{contactDetails.last_name.charAt(0).toUpperCase()}
              </div>
              <h2 style={styles.profileName}>{contactDetails.first_name} {contactDetails.last_name}</h2>
              {contactDetails.job_title && (
                <div style={styles.profileRole}>
                  <Briefcase size={14} style={{ marginRight: 6 }} />
                  <span>{contactDetails.job_title} @ {contactDetails.company || 'Freelance'}</span>
                </div>
              )}
              {contactDetails.location && (
                <div style={styles.profileLocation}>
                  <MapPin size={14} style={{ marginRight: 6 }} />
                  <span>{contactDetails.location}</span>
                </div>
              )}
            </div>

            {/* Tags list */}
            <div style={styles.infoBlock}>
              <div style={styles.blockTitleHeader}>
                <Tag size={14} color="var(--text-secondary)" />
                <h4 style={styles.blockTitle}>Tags & Secteurs</h4>
              </div>
              <div style={styles.tagContainer}>
                {contactDetails.tags.length === 0 ? (
                  <span style={styles.emptyText}>Aucun tag associé.</span>
                ) : (
                  contactDetails.tags.map((t: any) => (
                    <span 
                      key={t.id} 
                      style={{ 
                        ...styles.tagBadge, 
                        borderColor: 'var(--border-glow)', 
                        background: 'rgba(255,255,255,0.03)'
                      }}
                    >
                      {t.name}
                    </span>
                  ))
                )}
              </div>
            </div>

            {/* Description */}
            <div style={styles.infoBlock}>
              <h4 style={styles.blockTitle}>Description / Bio</h4>
              <p style={styles.drawerBioText}>
                {contactDetails.bio || "Pas de description renseignée."}
              </p>
            </div>

            {/* AI Summary Context */}
            {contactDetails.ai_context && (
              <div className="glow-active" style={styles.aiContextBlock}>
                <div style={styles.aiContextTitle}>
                  <Sparkles size={14} color="var(--neon-purple)" />
                  <span>Synthèse IA (Gemini)</span>
                </div>
                <p style={styles.aiContextText}>{contactDetails.ai_context}</p>
              </div>
            )}

            {/* Coordonnées Details */}
            <div style={styles.infoBlock}>
              <h4 style={styles.blockTitle}>Coordonnées</h4>
              <div style={styles.contactDetailsList}>
                {contactDetails.email && (
                  <div style={styles.detailsItem}>
                    <Mail size={14} color="var(--text-muted)" style={{ marginRight: 8 }} />
                    <span style={styles.detailsText}>{contactDetails.email}</span>
                  </div>
                )}
                {contactDetails.phone && (
                  <div style={styles.detailsItem}>
                    <Phone size={14} color="var(--text-muted)" style={{ marginRight: 8 }} />
                    <span style={styles.detailsText}>{contactDetails.phone}</span>
                  </div>
                )}
                {contactDetails.linkedin && (
                  <a href={contactDetails.linkedin} target="_blank" rel="noreferrer" style={styles.linkedinLink}>
                    <ExternalLink size={14} style={{ marginRight: 6 }} />
                    Profil LinkedIn
                  </a>
                )}
                {!contactDetails.email && !contactDetails.phone && !contactDetails.linkedin && (
                  <span style={styles.emptyText}>Aucune coordonnée renseignée.</span>
                )}
              </div>
            </div>

            {/* Appartenance aux Galaxies (Multi-liaison) */}
            <div style={styles.infoBlock}>
              <div style={styles.blockTitleHeader}>
                <Layers size={14} color="var(--neon-purple)" />
                <h4 style={styles.blockTitle}>Appartenance aux Galaxies</h4>
              </div>
              <div className="glass-card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <p style={{ fontSize: '0.725rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.45 }}>
                  Cochez les galaxies dans lesquelles ce contact doit figurer.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {spaces.map(s => {
                    const isChecked = selectedSpaces.includes(s.id);
                    return (
                      <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.8rem', color: '#fff', cursor: 'pointer' }}>
                        <input 
                          type="checkbox" 
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedSpaces([...selectedSpaces, s.id]);
                            } else {
                              setSelectedSpaces(selectedSpaces.filter(sid => sid !== s.id));
                            }
                          }}
                        />
                        <span>{s.name} ({s.type === 'personal' ? '🔒 Perso' : '👥 Partagé'})</span>
                      </label>
                    );
                  })}
                </div>
                <button 
                  onClick={handleUpdateContactSpaces}
                  disabled={updatingSpaces || selectedSpaces.length === 0}
                  className="btn-primary"
                  style={{ fontSize: '0.75rem', padding: '8px 12px', marginTop: 4 }}
                >
                  {updatingSpaces ? "Enregistrement..." : "Valider l'Appartenance 🤝"}
                </button>
              </div>
            </div>

            {/* Fusion de Galaxies (Partage d'Espace) */}
            <div style={styles.infoBlock}>
              <div style={styles.blockTitleHeader}>
                <Globe size={14} color="var(--neon-green)" />
                <h4 style={styles.blockTitle}>Fusion de Galaxies (Partage)</h4>
              </div>
              <div className="glass-card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <p style={{ fontSize: '0.725rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.45 }}>
                  Invitez ce contact à fusionner ses contacts avec les vôtres au sein d'un Espace Partagé.
                </p>
                {teamSpaces.length === 0 ? (
                  <span style={styles.emptyText}>
                    Vous n'avez aucun Espace Collaboratif créé. Allez dans l'onglet <b>Galaxies / Espaces</b> pour en créer un, puis revenez ici !
                  </span>
                ) : (
                  <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <label style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-muted)' }}>CERCLE / ESPACE PARTAGÉ</label>
                      <select 
                        value={inviteSpaceId} 
                        onChange={(e) => setInviteSpaceId(e.target.value)} 
                        style={styles.selectSmall}
                      >
                        <option value="">Sélectionner un Espace...</option>
                        {teamSpaces.map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <label style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-muted)' }}>EMAIL DU CONTACT</label>
                      <input 
                        type="email" 
                        value={inviteEmail} 
                        onChange={(e) => setInviteEmail(e.target.value)} 
                        placeholder="Ex: contact@email.com"
                        style={styles.inputSmall}
                      />
                    </div>

                    <button 
                      onClick={handleSendMergeInvitation}
                      disabled={sendingInvite || !inviteSpaceId || !inviteEmail}
                      className="btn-primary"
                      style={{ fontSize: '0.75rem', padding: '8px 12px', marginTop: 4 }}
                    >
                      {sendingInvite ? "Envoi de la demande..." : "Envoyer l'invitation de fusion 🌌"}
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Connections list */}
            <div style={styles.infoBlock}>
              <div style={styles.blockTitleHeader}>
                <Orbit size={14} color="var(--text-secondary)" />
                <h4 style={styles.blockTitle}>Connexions Directes ({directConnections.length})</h4>
              </div>
              <div style={styles.connectionsContainer}>
                {directConnections.length === 0 ? (
                  <span style={styles.emptyText}>Aucune connexion directe détectée.</span>
                ) : (
                  directConnections.map(({ contact, reason, type }) => (
                    <div 
                      key={contact.id} 
                      className="connection-item"
                      style={styles.connectionCard}
                      onClick={() => setSelectedContactId(contact.id)}
                    >
                      <div style={styles.avatarSmall}>
                        {contact.first_name.charAt(0)}{contact.last_name.charAt(0)}
                      </div>
                      <div style={styles.connectionDetails}>
                        <span style={styles.connectionName}>{contact.first_name} {contact.last_name}</span>
                        <span style={styles.connectionReason}>
                          {type === 'company' ? '🏢 ' : '🏷️ '}
                          {reason}
                        </span>
                      </div>
                      <ArrowRight size={14} color="var(--text-muted)" />
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Synergy Connections (IA) */}
            <div style={styles.infoBlock}>
              <div style={styles.blockTitleHeader}>
                <Sparkles size={14} color="var(--neon-purple)" />
                <h4 style={styles.blockTitle}>Synergies IA (Gemini)</h4>
              </div>
              
              {!isGeminiConfigured() ? (
                <div style={styles.synergyNotice}>
                  <Key size={14} color="var(--text-muted)" style={{ marginRight: 6 }} />
                  <span style={styles.emptyText}>Clé Gemini requise pour activer l'Oracle.</span>
                </div>
              ) : !hasSearchedSynergies && !loadingSynergies ? (
                <button 
                  onClick={handleFetchSynergies}
                  className="btn-secondary"
                  style={{ 
                    width: '100%', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    gap: 8,
                    fontSize: '0.8rem',
                    padding: '8px 12px'
                  }}
                >
                  <Zap size={14} color="var(--neon-yellow)" />
                  Détecter les Synergies IA
                </button>
              ) : null}

              {loadingSynergies && (
                <div style={styles.synergyLoading}>
                  <div className="orbit-spinner" style={{ width: 24, height: 24 }}></div>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Calcul cosmique...</span>
                </div>
              )}

              {synergyError && (
                <span style={{ fontSize: '0.75rem', color: 'var(--neon-pink)' }}>{synergyError}</span>
              )}

              {hasSearchedSynergies && !loadingSynergies && (
                <div style={styles.synergiesContainer}>
                  {synergies.length === 0 ? (
                    <span style={styles.emptyText}>Aucune synergie trouvée.</span>
                  ) : (
                    synergies.map((syn, idx) => (
                      <div key={idx} className="glass-card" style={styles.synergySubCard}>
                        <h5 style={styles.synergyCardTitle}>{syn.title}</h5>
                        <p style={styles.synergyDesc}>{syn.description}</p>
                        
                        <div 
                          className="synergy-party"
                          style={styles.synergyParty}
                          onClick={() => setSelectedContactId(syn.targetContact.id)}
                        >
                          <span style={styles.partyLabelSmall}>AVEC</span>
                          <span style={styles.partyNameSmall}>{syn.targetContact.name}</span>
                          <span style={styles.partyMetaSmall}>{syn.targetContact.role} @ {syn.targetContact.company}</span>
                        </div>

                        <div style={styles.synergyReasonBox}>
                          <span style={styles.synergyBoxTitle}>Pourquoi :</span>
                          <p style={styles.synergyBoxText}>{syn.matchReason}</p>
                        </div>

                        {syn.recommendedIntroPath && (
                          <div style={styles.synergyIntroBox}>
                            <span style={styles.synergyBoxTitle}>Introduction :</span>
                            <p style={{ ...styles.synergyBoxText, color: 'var(--neon-blue)' }}>{syn.recommendedIntroPath}</p>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                  
                  <button 
                    onClick={handleFetchSynergies}
                    className="btn-secondary"
                    style={{ 
                      width: '100%', 
                      fontSize: '0.75rem',
                      padding: '6px 12px',
                      marginTop: 4
                    }}
                  >
                    Mettre à jour l'analyse
                  </button>
                </div>
              )}
            </div>

            {/* Public Web Ingestion & Enrichment */}
            <div style={styles.enrichmentBlock}>
              {!showEnrichForm ? (
                <button 
                  onClick={() => setShowEnrichForm(true)} 
                  className="btn-secondary"
                  style={{ width: '100%', fontSize: '0.8rem', padding: '8px 12px' }}
                >
                  ✨ Enrichir via Scraping Web (IA)
                </button>
              ) : (
                <div className="glass-card" style={styles.enrichForm}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <h5 style={{ margin: 0, fontSize: '0.8rem', color: '#fff' }}>Données Web à analyser</h5>
                    <button onClick={() => setShowEnrichForm(false)} style={styles.closeBtnSmall}>
                      <X size={12} />
                    </button>
                  </div>
                  <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: '0 0 10px 0', lineHeight: 1.3 }}>
                    Collez du texte brut récolté (profil LinkedIn, page web, article) pour enrichir sa bio et ses compétences.
                  </p>
                  <textarea 
                    value={scrapedText}
                    onChange={(e) => setScrapedText(e.target.value)}
                    placeholder="Collez le texte brut ici..."
                    style={styles.scrapedInput}
                  />
                  <button 
                    onClick={handleEnrichProfile}
                    disabled={enriching}
                    className="btn-primary"
                    style={{ width: '100%', fontSize: '0.75rem', padding: '8px 12px', marginTop: 8 }}
                  >
                    {enriching ? 'Enrichissement IA...' : 'Lancer l\'analyse d\'enrichissement'}
                  </button>
                </div>
              )}
            </div>

            {/* Note logs */}
            <div style={styles.infoBlock}>
              <div style={styles.blockTitleHeader}>
                <Clock size={14} color="var(--text-secondary)" style={{ marginRight: 6 }} />
                <h4 style={styles.blockTitle}>Notes de réunions ({contactDetails.notes.length})</h4>
              </div>
              <div style={styles.drawerNotesList}>
                {contactDetails.notes.length === 0 ? (
                  <span style={styles.emptyText}>Aucune note répertoriée pour ce contact.</span>
                ) : (
                  contactDetails.notes.map((n: any) => (
                    <div key={n.id} style={styles.drawerNoteItem}>
                      <div style={styles.drawerNoteHeader}>
                        <span style={styles.drawerNoteDate}>
                          {new Date(n.created_at).toLocaleDateString('fr-FR', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric'
                          })}
                        </span>
                        <span style={{
                          ...styles.drawerNoteContext,
                          color: n.context === 'professional' ? 'var(--neon-blue)' : 'var(--neon-yellow)'
                        }}>
                          {n.context === 'professional' ? 'Pro' : 'Perso'}
                        </span>
                      </div>
                      <p style={styles.drawerNoteText}>{n.content}</p>
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    height: '100%',
    width: '100%',
    position: 'relative',
    overflow: 'hidden',
  },
  mainLayout: {
    padding: '30px',
    height: '100%',
    overflowY: 'auto',
    transition: 'margin-right 0.3s ease-in-out',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
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
    marginBottom: 24,
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
    minHeight: '80px',
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
    marginBottom: 24,
  },
  searchInput: {
    background: 'none',
    border: 'none',
    color: '#fff',
    outline: 'none',
    fontSize: '0.95rem',
    width: '100%',
  },
  contactsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: 20,
  },
  contactCard: {
    padding: 20,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    transition: 'var(--transition-smooth)',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: '12px',
    background: 'rgba(255, 255, 255, 0.04)',
    border: '1.5px solid var(--neon-purple)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    color: '#fff',
    fontSize: '0.95rem',
    fontWeight: 700,
    flexShrink: 0,
  },
  name: {
    fontSize: '1.05rem',
    fontWeight: 700,
    color: '#fff',
    marginBottom: 2,
  },
  spaceBadge: {
    fontSize: '0.65rem',
    fontWeight: 600,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
  },
  detailsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    padding: '10px 0',
    borderTop: '1px solid rgba(255,255,255,0.03)',
    borderBottom: '1px solid rgba(255,255,255,0.03)',
  },
  detailItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  detailText: {
    fontSize: '0.8rem',
    color: 'var(--text-secondary)',
  },
  bioText: {
    fontSize: '0.8rem',
    color: 'var(--text-muted)',
    lineHeight: 1.45,
    fontStyle: 'italic',
  },
  emptyState: {
    gridColumn: '1 / -1',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    border: '1.5px dashed var(--border-glow)',
    borderRadius: 16,
    color: 'var(--text-muted)',
  },

  // Drawer styles
  drawer: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: '400px',
    height: '100%',
    zIndex: 100,
    display: 'flex',
    flexDirection: 'column',
    borderLeft: '1px solid var(--border-glow)',
    background: 'rgba(10, 10, 18, 0.95)',
    boxShadow: '-10px 0 30px rgba(0, 0, 0, 0.5)',
    backdropFilter: 'blur(12px)',
  },
  drawerHeader: {
    padding: '20px 24px',
    borderBottom: '1px solid var(--border-glow)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  drawerTitle: {
    fontSize: '1rem',
    fontWeight: 700,
    color: '#fff',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    padding: 4,
    borderRadius: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'var(--transition-smooth)',
  },
  closeBtnSmall: {
    background: 'none',
    border: 'none',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
  },
  drawerContent: {
    padding: '24px',
    overflowY: 'auto',
    flexGrow: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 24,
  },
  profileSection: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    borderBottom: '1px solid rgba(255,255,255,0.03)',
    paddingBottom: 20,
  },
  avatarBig: {
    width: 68,
    height: 68,
    borderRadius: '20px',
    background: 'rgba(159, 97, 232, 0.1)',
    border: '2px solid var(--neon-purple)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    color: '#fff',
    fontSize: '1.5rem',
    fontWeight: 700,
    marginBottom: 14,
  },
  profileName: {
    fontSize: '1.35rem',
    fontWeight: 800,
    color: '#fff',
    marginBottom: 8,
  },
  profileRole: {
    fontSize: '0.85rem',
    color: 'var(--text-secondary)',
    display: 'flex',
    alignItems: 'center',
    marginBottom: 4,
  },
  profileLocation: {
    fontSize: '0.8rem',
    color: 'var(--text-muted)',
    display: 'flex',
    alignItems: 'center',
  },
  infoBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  blockTitleHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  blockTitle: {
    fontSize: '0.8rem',
    fontWeight: 700,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  tagContainer: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
  },
  tagBadge: {
    fontSize: '0.75rem',
    padding: '4px 10px',
    borderRadius: 99,
    border: '1px solid',
  },
  emptyText: {
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
    fontStyle: 'italic',
  },
  drawerBioText: {
    fontSize: '0.8rem',
    color: 'var(--text-secondary)',
    lineHeight: 1.45,
  },
  aiContextBlock: {
    background: 'rgba(159, 97, 232, 0.05)',
    border: '1px solid rgba(159, 97, 232, 0.2)',
    borderRadius: 12,
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  aiContextTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: '0.8rem',
    fontWeight: 700,
    color: 'var(--neon-purple)',
  },
  aiContextText: {
    fontSize: '0.775rem',
    color: 'var(--text-secondary)',
    lineHeight: 1.4,
  },
  contactDetailsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  detailsItem: {
    display: 'flex',
    alignItems: 'center',
  },
  detailsText: {
    fontSize: '0.8rem',
    color: 'var(--text-secondary)',
  },
  linkedinLink: {
    display: 'inline-flex',
    alignItems: 'center',
    fontSize: '0.8rem',
    color: 'var(--neon-blue)',
    textDecoration: 'none',
    fontWeight: 600,
    marginTop: 4,
    alignSelf: 'flex-start',
  },
  connectionsContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  connectionCard: {
    display: 'flex',
    alignItems: 'center',
    background: 'rgba(255, 255, 255, 0.02)',
    border: '1px solid rgba(255, 255, 255, 0.04)',
    borderRadius: 8,
    padding: '10px 12px',
    cursor: 'pointer',
    transition: 'var(--transition-smooth)',
  },
  avatarSmall: {
    width: 28,
    height: 28,
    borderRadius: '50%',
    background: 'rgba(255, 255, 255, 0.04)',
    border: '1.5px solid var(--neon-purple)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
    flexShrink: 0,
    fontSize: '0.75rem',
    fontWeight: 700,
    color: '#fff',
  },
  connectionDetails: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    overflow: 'hidden',
  },
  connectionName: {
    fontSize: '0.8rem',
    fontWeight: 600,
    color: '#fff',
  },
  connectionReason: {
    fontSize: '0.7rem',
    color: 'var(--text-secondary)',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
  },
  synergyNotice: {
    display: 'flex',
    alignItems: 'center',
    background: 'rgba(255, 255, 255, 0.01)',
    border: '1px solid var(--border-glow)',
    borderRadius: 8,
    padding: 10,
  },
  synergyLoading: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: 12,
  },
  synergiesContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  synergySubCard: {
    background: 'rgba(159, 97, 232, 0.03)',
    border: '1px solid rgba(159, 97, 232, 0.15)',
    borderRadius: 10,
    padding: 14,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  synergyCardTitle: {
    fontSize: '0.85rem',
    fontWeight: 700,
    color: '#fff',
  },
  synergyDesc: {
    fontSize: '0.75rem',
    color: 'var(--text-secondary)',
    lineHeight: 1.4,
  },
  synergyParty: {
    display: 'flex',
    flexDirection: 'column',
    background: 'rgba(0, 0, 0, 0.2)',
    border: '1px solid var(--border-glow)',
    padding: 10,
    borderRadius: 8,
    cursor: 'pointer',
    transition: 'var(--transition-smooth)',
  },
  partyLabelSmall: {
    fontSize: '0.6rem',
    fontWeight: 800,
    color: 'var(--neon-green)',
    letterSpacing: '0.05em',
  },
  partyNameSmall: {
    fontSize: '0.8rem',
    fontWeight: 700,
    color: '#fff',
  },
  partyMetaSmall: {
    fontSize: '0.7rem',
    color: 'var(--text-muted)',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    overflow: 'hidden',
  },
  synergyReasonBox: {
    background: 'rgba(255, 255, 255, 0.02)',
    padding: 10,
    borderRadius: 6,
    borderLeft: '2.5px solid var(--neon-purple)',
  },
  synergyIntroBox: {
    background: 'rgba(79, 142, 247, 0.04)',
    padding: 10,
    borderRadius: 6,
    borderLeft: '2.5px solid var(--neon-blue)',
  },
  synergyBoxTitle: {
    fontSize: '0.65rem',
    fontWeight: 700,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    display: 'block',
    marginBottom: 2,
  },
  synergyBoxText: {
    fontSize: '0.75rem',
    color: 'var(--text-secondary)',
    lineHeight: 1.35,
  },
  enrichmentBlock: {
    marginTop: 10,
  },
  enrichForm: {
    padding: 14,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  scrapedInput: {
    background: 'rgba(0,0,0,0.2)',
    border: '1px solid var(--border-glow)',
    borderRadius: 6,
    padding: 8,
    color: '#fff',
    outline: 'none',
    fontSize: '0.75rem',
    minHeight: '60px',
    resize: 'vertical',
    width: '100%',
  },
  drawerNotesList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  drawerNoteItem: {
    background: 'rgba(255, 255, 255, 0.02)',
    border: '1px solid rgba(255, 255, 255, 0.04)',
    borderRadius: 8,
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  drawerNoteHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  drawerNoteDate: {
    fontSize: '0.7rem',
    color: 'var(--text-muted)',
  },
  drawerNoteContext: {
    fontSize: '0.65rem',
    fontWeight: 700,
    textTransform: 'uppercase',
  },
  drawerNoteText: {
    fontSize: '0.775rem',
    color: 'var(--text-secondary)',
    lineHeight: 1.4,
  },
  selectSmall: {
    background: 'rgba(0,0,0,0.3)',
    border: '1px solid var(--border-glow)',
    borderRadius: 6,
    padding: '6px 10px',
    color: '#fff',
    outline: 'none',
    fontSize: '0.8rem',
  },
  inputSmall: {
    background: 'rgba(0,0,0,0.3)',
    border: '1px solid var(--border-glow)',
    borderRadius: 6,
    padding: '6px 10px',
    color: '#fff',
    outline: 'none',
    fontSize: '0.8rem',
  },
  bulkActionBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 18px',
    background: 'rgba(159, 97, 232, 0.08)',
    border: '1px solid rgba(159, 97, 232, 0.3)',
    borderRadius: 12,
    marginBottom: 16,
    flexWrap: 'wrap',
    gap: 12,
    boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
  },
  selectSmallBulk: {
    background: 'rgba(0,0,0,0.3)',
    border: '1px solid var(--border-glow)',
    borderRadius: 6,
    padding: '6px 10px',
    color: '#fff',
    outline: 'none',
    fontSize: '0.8rem',
    minWidth: '180px',
  },
  cardCheckbox: {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 16,
    height: 16,
    cursor: 'pointer',
    accentColor: 'var(--neon-purple)',
    zIndex: 10,
  }
};
