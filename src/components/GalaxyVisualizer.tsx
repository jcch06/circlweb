import React, { useState, useEffect, useRef, useMemo } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { supabase } from '../lib/supabase';
import { enrichProfileFromScraping, isMistralConfigured, detectContactSynergies, getCachedMistralPipelineResult } from '../lib/mistral';
import type { ContactSynergy, BridgeContact } from '../lib/mistral';


interface GalaxyVisualizerProps {
  contacts: any[];
  spaces: any[];
  notes: any[];
  tags: any[];
  contactTags: any[];
  selectedSpaceId: string | null;
  user: any;
  onRefreshData: () => Promise<void>;
}

export const GalaxyVisualizer: React.FC<GalaxyVisualizerProps> = ({
  contacts,
  spaces,
  notes,
  tags,
  contactTags,
  selectedSpaceId,
  user,
  onRefreshData
}) => {
  const [selectedNode, setSelectedNode] = useState<any | null>(null);
  const [enriching, setEnriching] = useState(false);
  const [scrapedText, setScrapedText] = useState('');
  const [showEnrichForm, setShowEnrichForm] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<any>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  // Synergy States
  const [synergies, setSynergies] = useState<ContactSynergy[]>([]);
  const [loadingSynergies, setLoadingSynergies] = useState(false);
  const [synergyError, setSynergyError] = useState<string | null>(null);
  const [hasSearchedSynergies, setHasSearchedSynergies] = useState(false);

  // Reset synergy search when selected node changes
  useEffect(() => {
    setSynergies([]);
    setLoadingSynergies(false);
    setSynergyError(null);
    setHasSearchedSynergies(false);
  }, [selectedNode?.id]);

  // Galaxy Merge Invitation States
  const [inviteSpaceId, setInviteSpaceId] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [sendingInvite, setSendingInvite] = useState(false);

  // Galaxy Membership States
  const [selectedSpaces, setSelectedSpaces] = useState<string[]>([]);
  const [updatingSpaces, setUpdatingSpaces] = useState(false);

  // Compute team/collaborative spaces
  const teamSpaces = useMemo(() => {
    return spaces.filter(s => s.type === 'team');
  }, [spaces]);

  // Prefill invitation details & current space membership when selected node changes
  useEffect(() => {
    if (selectedNode) {
      setInviteEmail(selectedNode.email || '');
      const firstTeamSpace = spaces.find(s => s.type === 'team');
      setInviteSpaceId(firstTeamSpace?.id || '');

      // Find all spaces where a contact with same name exists
      const sameNameContacts = contacts.filter(
        c => c.first_name.toLowerCase() === selectedNode.first_name.toLowerCase() && 
             c.last_name.toLowerCase() === selectedNode.last_name.toLowerCase()
      );
      setSelectedSpaces(sameNameContacts.map(c => c.space_id));
    } else {
      setInviteEmail('');
      setInviteSpaceId('');
      setSelectedSpaces([]);
    }
  }, [selectedNode?.id, spaces, contacts]);

  const handleUpdateContactSpaces = async () => {
    if (!selectedNode) return;
    setUpdatingSpaces(true);
    try {
      const currentSpaces = contacts
        .filter(c => c.first_name.toLowerCase() === selectedNode.first_name.toLowerCase() && 
                     c.last_name.toLowerCase() === selectedNode.last_name.toLowerCase())
        .map(c => c.space_id);

      // 1. Add to new spaces
      const spacesToAdd = selectedSpaces.filter(sid => !currentSpaces.includes(sid));
      for (const spaceId of spacesToAdd) {
        const { error } = await supabase.from('contacts').insert({
          space_id: spaceId,
          owner_id: user.id,
          first_name: selectedNode.first_name,
          last_name: selectedNode.last_name,
          company: selectedNode.company,
          job_title: selectedNode.job_title,
          industry: selectedNode.industry,
          location: selectedNode.location,
          bio: selectedNode.bio,
          email: selectedNode.email,
          phone: selectedNode.phone,
          linkedin: selectedNode.linkedin,
          ai_context: selectedNode.ai_context,
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
          .eq('first_name', selectedNode.first_name)
          .eq('last_name', selectedNode.last_name);
        if (error) throw error;
      }

      alert("Liaisons avec les Galaxies mises à jour !");
      await onRefreshData();
      
      // If we removed the contact from the current space, close the drawer
      if (spacesToRemove.includes(selectedNode.space_id)) {
        setSelectedNode(null);
      }
    } catch (err: any) {
      console.error(err);
      alert(`Erreur lors de la mise à jour : ${err.message || 'Impossible de modifier les galaxies.'}`);
    } finally {
      setUpdatingSpaces(false);
    }
  };

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

  // Filter contacts based on space selection
  const activeContacts = useMemo(() => {
    return selectedSpaceId
      ? contacts.filter(c => c.space_id === selectedSpaceId)
      : contacts;
  }, [contacts, selectedSpaceId]);

  // Bridge contacts (strategic connectors) surfaced by a cached Oracle analysis, if any.
  // Read-only lookup — never triggers a new (paid) analysis from the galaxy view.
  const bridgeContactMap = useMemo(() => {
    const map = new Map<string, BridgeContact>();
    if (activeContacts.length === 0) return map;
    const cached = getCachedMistralPipelineResult(activeContacts);
    cached?.bridgeContacts?.forEach(b => map.set(b.id, b));
    return map;
  }, [activeContacts]);

  // Floating Search and Selection State
  const [searchQuery, setSearchQuery] = useState('');
  const [mouseDownCoords, setMouseDownCoords] = useState<{ x: number; y: number } | null>(null);

  // Filter contacts by query
  const filteredContacts = useMemo(() => {
    if (!searchQuery.trim()) return activeContacts;
    const query = searchQuery.toLowerCase();
    return activeContacts.filter(c => 
      c.first_name?.toLowerCase().includes(query) ||
      c.last_name?.toLowerCase().includes(query) ||
      (c.company && c.company.toLowerCase().includes(query)) ||
      (c.job_title && c.job_title.toLowerCase().includes(query))
    );
  }, [activeContacts, searchQuery]);

  // Center on node and open details when clicked from search list
  const handleSelectContact = (contact: any) => {
    setSelectedNode(contact);
    if (fgRef.current && typeof contact.x === 'number' && typeof contact.y === 'number') {
      fgRef.current.centerAt(contact.x, contact.y, 800);
      fgRef.current.zoom(2.5, 800);
    }
  };

  // Fallback direct coordinate click detection to guarantee clicks work at any scale
  const handleCanvasClick = (e: React.MouseEvent) => {
    if (!fgRef.current) return;

    // Convert click coordinates to graph coordinates
    const graphCoords = fgRef.current.screen2GraphCoords(e.clientX, e.clientY);
    if (!graphCoords) return;

    let nearestNode: any = null;
    let minDistance = Infinity;
    const scale = fgRef.current.zoom() || 1;
    const maxClickDistanceScreen = 26; // accessible click range in screen pixels

    graphData.nodes.forEach(node => {
      // 1. Distance to node center
      const dx = graphCoords.x - node.x;
      const dy = graphCoords.y - node.y;
      const distGraph = Math.sqrt(dx * dx + dy * dy);
      const distScreen = distGraph * scale;

      // 2. Distance to label center
      const size = 4;
      const labelCenterY = node.y + size + 12.5 / scale;
      const dyLabel = graphCoords.y - labelCenterY;
      const distLabelGraph = Math.sqrt(dx * dx + dyLabel * dyLabel);
      const distLabelScreen = distLabelGraph * scale;

      const finalDistScreen = Math.min(distScreen, distLabelScreen);

      if (finalDistScreen < minDistance && finalDistScreen < maxClickDistanceScreen) {
        minDistance = finalDistScreen;
        nearestNode = node;
      }
    });

    if (nearestNode) {
      setSelectedNode(nearestNode);
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setMouseDownCoords({ x: e.clientX, y: e.clientY });
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!mouseDownCoords) return;
    const dx = e.clientX - mouseDownCoords.x;
    const dy = e.clientY - mouseDownCoords.y;
    const dragDistance = Math.sqrt(dx * dx + dy * dy);
    
    setMouseDownCoords(null);
    
    // Ignore drags / panning events (movement larger than 5 pixels)
    if (dragDistance > 5) return;
    handleCanvasClick(e);
  };


  // Update canvas size responsively
  useEffect(() => {
    if (containerRef.current) {
      setDimensions({
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
      });
    }

    const handleResize = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Configure repulsion forces to space out nodes beautifully without flying apart
  useEffect(() => {
    if (fgRef.current) {
      fgRef.current.d3Force('charge').strength(-35);
      fgRef.current.d3Force('link').distance(60);
    }
  }, [activeContacts]);

  // Construct Graph Data (Nodes & Links)
  const graphData = useMemo(() => {
    const nodes = activeContacts.map(c => {
      // Pick a glowing neon color based on their Space ID
      // If we are in "Galaxy Merger" mode (selectedSpaceId is null), we want to color code them differently to show who belongs to which circle!
      const spaceIndex = spaces.findIndex(s => s.id === c.space_id);
      const colors = ['#4F8EF7', '#9F61E8', '#EC6F8B', '#30C060', '#D4A030', '#E89030'];
      const color = colors[spaceIndex % colors.length] || '#9F61E8';
      const bridge = bridgeContactMap.get(c.id);

      return {
        ...c,
        id: c.id,
        color,
        isBridge: Boolean(bridge),
        centralityScore: bridge?.centralityScore ?? 0,
      };
    });

    const links: any[] = [];

    // Filter tags to keep only high-value categories (industrie, relation) and exclude noise (contexte, statut)
    const linkTagIds = new Set(
      tags
        .filter(t => t.category !== 'contexte' && t.category !== 'statut')
        .map(t => t.id)
    );

    // Connect contacts by shared criteria (Implicit connections)
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const nodeA = nodes[i];
        const nodeB = nodes[j];

        // 1. Shared Company
        const sharedCompany = nodeA.company && nodeB.company && 
          nodeA.company.trim().toLowerCase() === nodeB.company.trim().toLowerCase() && 
          nodeA.company.toLowerCase() !== 'inconnue' && 
          nodeA.company.toLowerCase() !== 'freelance';

        // 2. Shared High-Value Tags (skills, sectors, relations)
        const tagsA = new Set(
          contactTags
            .filter(ct => ct.contact_id === nodeA.id && linkTagIds.has(ct.tag_id))
            .map(ct => ct.tag_id)
        );
        const tagsB = contactTags
          .filter(ct => ct.contact_id === nodeB.id && linkTagIds.has(ct.tag_id))
          .map(ct => ct.tag_id);
        const hasSharedTag = tagsB.some(tagId => tagsA.has(tagId));

        if (sharedCompany) {
          links.push({ source: nodeA.id, target: nodeB.id, type: 'company', val: 3 });
        } else if (hasSharedTag) {
          links.push({ source: nodeA.id, target: nodeB.id, type: 'tag', val: 1.5 });
        }
      }
    }

    return { nodes, links };
  }, [activeContacts, spaces, contactTags, selectedSpaceId, bridgeContactMap]);

  // Fetch full details for the selected contact drawer (including notes and tags)
  const contactDetails = useMemo(() => {
    if (!selectedNode) return null;
    const contactId = selectedNode.id;

    const contactNotes = notes.filter(n => n.contact_id === contactId);
    const contactTagIds = contactTags.filter(ct => ct.contact_id === contactId).map(ct => ct.tag_id);
    const associatedTags = tags.filter(t => contactTagIds.includes(t.id));

    return {
      ...selectedNode,
      notes: contactNotes,
      tags: associatedTags,
    };
  }, [selectedNode, notes, tags, contactTags]);

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

    return activeContacts
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
  }, [contactDetails, activeContacts, contactTags, tags]);

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
    if (!selectedNode) return;
    if (!scrapedText.trim()) {
      alert("Veuillez coller du texte brut à analyser.");
      return;
    }

    setEnriching(true);

    try {
      if (!isMistralConfigured()) {
        throw new Error("Clé Mistral API non configurée. Veuillez ajouter votre clé dans le fichier .env.local.");
      }

      // Call Mistral enrichment helper
      const enrichment = await enrichProfileFromScraping(
        selectedNode.first_name,
        selectedNode.company || 'Inconnue',
        scrapedText
      );

      // Save enrichment to Supabase
      const { error: updateError } = await supabase
        .from('contacts')
        .update({
          bio: enrichment.bio,
          industry: enrichment.industry,
          company_size: enrichment.companySize,
          ai_context: enrichment.aiContext,
          enriched_at: new Date().toISOString(),
          source: 'enrichment'
        })
        .eq('id', selectedNode.id);

      if (updateError) throw updateError;

      // Best-effort: also persist skills / inferred_needs as columns so the synergy
      // and supply/demand engines have structured material. Guarded so a missing
      // column (migration not yet applied) never breaks the enrichment flow.
      try {
        const extras: Record<string, string[]> = {};
        if (Array.isArray(enrichment.skills) && enrichment.skills.length > 0) {
          extras.skills = enrichment.skills.filter((s: string) => s && s !== 'null');
        }
        if (Array.isArray(enrichment.inferredNeeds) && enrichment.inferredNeeds.length > 0) {
          extras.inferred_needs = enrichment.inferredNeeds.filter((n: string) => n && n !== 'null');
        }
        if (Object.keys(extras).length > 0) {
          await supabase.from('contacts').update(extras).eq('id', selectedNode.id);
        }
      } catch (extrasErr) {
        console.warn('Persistance skills/inferred_needs ignorée (migration manquante ?)', extrasErr);
      }

      // Seed newly extracted tags if they don't exist, and associate them
      for (const skill of enrichment.skills) {
        // Try to find if tag exists in this space
        let { data: tag } = await supabase
          .from('tags')
          .select('id')
          .eq('space_id', selectedNode.space_id)
          .eq('name', skill)
          .maybeSingle();

        if (!tag) {
          const { data: newTag, error: tagErr } = await supabase
            .from('tags')
            .insert({
              space_id: selectedNode.space_id,
              name: skill,
              category: 'industrie',
              color_hex: '#9F61E8' // purple for skills
            })
            .select('id')
            .single();
          
          if (!tagErr) tag = newTag;
        }

        if (tag) {
          // Link tag
          await supabase
            .from('contact_tags')
            .insert({
              contact_id: selectedNode.id,
              tag_id: tag.id,
              tagged_by: (await supabase.auth.getUser()).data.user?.id
            })
            .maybeSingle();
        }
      }

      await onRefreshData();
      
      // Update selected node state to show changes immediately
      setSelectedNode({
        ...selectedNode,
        bio: enrichment.bio,
        industry: enrichment.industry,
        company_size: enrichment.companySize,
        ai_context: enrichment.aiContext
      });

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

  return (
    <div style={styles.container}>
      {/* Background space elements */}
      <div className="bg-grid"></div>
      <div className="bg-stars"></div>

      {/* Floating Search & Selection Panel */}
      <div className="glass-panel" style={styles.searchPanel}>
        <div style={styles.searchHeader}>
          
          <span style={styles.searchTitle}>Recherche d'Étoiles</span>
        </div>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Nom, entreprise, tag..."
          style={styles.searchInput}
        />
        <div style={styles.searchList}>
          {filteredContacts.length === 0 ? (
            <span style={styles.noResultsText}>Aucun contact</span>
          ) : (
            filteredContacts.map(c => {
              const isSelected = selectedNode?.id === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => handleSelectContact(c)}
                  style={{
                    ...styles.searchItem,
                    background: isSelected ? 'rgba(159, 97, 232, 0.15)' : 'none',
                    borderColor: isSelected ? 'rgba(159, 97, 232, 0.3)' : 'transparent',
                  }}
                  className="search-item-hover"
                >
                  <span style={styles.itemName}>{c.first_name} {c.last_name}</span>
                  {c.company && <span style={styles.itemCompany}>{c.company}</span>}
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Main Canvas Area */}
      <div 
        ref={containerRef} 
        style={styles.canvasContainer}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
      >
        {graphData.nodes.length === 0 ? (
          <div style={styles.emptyState}>
            
            <h3>Galaxie Vide</h3>
            <p>Générez des données démo ou ajoutez des contacts pour voir votre univers s'allumer.</p>
          </div>
        ) : (
          <ForceGraph2D
            ref={fgRef}
            graphData={graphData}
            width={dimensions.width}
            height={dimensions.height}
            backgroundColor="#06060a"
            linkColor={(link: any) => 
              link.type === 'company' ? 'rgba(79, 142, 247, 0.35)' : 
              link.type === 'tag' ? 'rgba(159, 97, 232, 0.3)' : 'rgba(255, 255, 255, 0.08)'
            }
            linkWidth={(link: any) => link.val || 1}
            onNodeClick={(node) => setSelectedNode(node)}
            cooldownTicks={80}
            d3AlphaDecay={0.03}
            d3VelocityDecay={0.4}
            nodePointerAreaPaint={(node: any, color, ctx, globalScale) => {
              if (typeof node.x !== 'number' || typeof node.y !== 'number' || isNaN(node.x) || isNaN(node.y)) {
                return;
              }
              ctx.fillStyle = color;
              
              // Get current zoom scale from ref or fallback argument
              const scale = fgRef.current?.zoom() || globalScale || 1;
              const size = 4;

              // Calculate width and height in graph coordinates to match a minimum on-screen target (80px x 55px)
              // or expand to cover the visual circle if it grows larger than that
              const width = Math.max(2 * size + 10 / scale, 80 / scale);
              const height = Math.max(2 * size + 20 / scale, 55 / scale);
              const offsetY = 8 / scale;

              ctx.beginPath();
              ctx.rect(node.x - width / 2, node.y + offsetY - height / 2, width, height);
              ctx.fill();
            }}
            nodeCanvasObject={(node: any, ctx, globalScale) => {
              if (typeof node.x !== 'number' || typeof node.y !== 'number' || isNaN(node.x) || isNaN(node.y)) {
                return;
              }
              const size = 4;

              // 0. Bridge contacts (strategic connectors from the Oracle analysis) get a glowing ring
              if (node.isBridge) {
                const ringSize = size + 3 + node.centralityScore * 3;
                ctx.save();
                ctx.shadowColor = '#a855f7';
                ctx.shadowBlur = 8;
                ctx.strokeStyle = 'rgba(168, 85, 247, 0.85)';
                ctx.lineWidth = 1.5 / globalScale;
                ctx.beginPath();
                ctx.arc(node.x, node.y, ringSize, 0, 2 * Math.PI, false);
                ctx.stroke();
                ctx.restore();
              }

              // 1. Draw solid circle star (extremely fast)
              ctx.fillStyle = node.color || '#9F61E8';
              ctx.beginPath();
              ctx.arc(node.x, node.y, size, 0, 2 * Math.PI, false);
              ctx.fill();

              // 2. Draw text label below it (always visible, viewport-independent sizing and spacing)
              const label = node.isBridge
                ? `★ ${node.first_name} ${node.last_name}`
                : `${node.first_name} ${node.last_name}`;
              const fontSize = 13 / globalScale;
              ctx.font = `${fontSize}px Inter, sans-serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'top';
              ctx.fillStyle = node.isBridge ? '#d8b4fe' : 'rgba(255, 255, 255, 0.9)';
              // Use scale-dependent offset to keep the text always exactly 6px below the star on screen
              ctx.fillText(label, node.x, node.y + size + 6 / globalScale);
            }}
          />
        )}
      </div>

      {/* Slide-out Contact Details Drawer */}
      {contactDetails && (
        <div className="glass-sidebar" style={styles.drawer}>
          <div style={styles.drawerHeader}>
            <span style={styles.drawerTitle}>Fiche Étoile</span>
            <button onClick={() => { setSelectedNode(null); setShowEnrichForm(false); }} style={styles.closeBtn}>
              
            </button>
          </div>

          <div style={styles.drawerContent}>
            {/* Profile Summary Card */}
            <div style={styles.profileSection}>
              <div style={{ ...styles.avatarBig, borderColor: contactDetails.color }}>
                
              </div>
              <h2 style={styles.profileName}>{contactDetails.first_name} {contactDetails.last_name}</h2>

              {contactDetails.isBridge && (
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '3px 10px', borderRadius: 99, marginTop: 4,
                  background: 'rgba(168,85,247,0.12)', border: '1px solid rgba(168,85,247,0.3)',
                  color: '#d8b4fe', fontSize: '0.75rem', fontWeight: 600
                }}>
                  ★ Connecteur clé du réseau
                </div>
              )}

              {contactDetails.job_title && (
                <div style={styles.profileRole}>
                  
                  <span>{contactDetails.job_title} @ {contactDetails.company || 'Freelance'}</span>
                </div>
              )}

              {contactDetails.location && (
                <div style={styles.profileLocation}>
                  
                  <span>{contactDetails.location}</span>
                </div>
              )}
            </div>

            {/* Tags (Skills & Relationship Status) */}
            <div style={styles.infoBlock}>
              <div style={styles.blockTitleHeader}>
                
                <h4 style={styles.blockTitle}>Tags & Secteurs</h4>
              </div>
              <div style={styles.tagContainer}>
                {contactDetails.tags.length === 0 ? (
                  <span style={styles.emptyText}>Aucun tag associé</span>
                ) : (
                  contactDetails.tags.map((t: any) => (
                    <span 
                      key={t.id} 
                      style={{ 
                        ...styles.tag, 
                        borderColor: t.color_hex, 
                        background: `${t.color_hex}15`,
                        color: t.color_hex 
                      }}
                    >
                      {t.name}
                    </span>
                  ))
                )}
              </div>
            </div>

            {/* Bio / Description */}
            <div style={styles.infoBlock}>
              <h4 style={styles.blockTitle}>Description / Bio</h4>
              <p style={styles.bioText}>
                {contactDetails.bio || "Pas de description renseignée pour ce contact."}
              </p>
            </div>

            {/* AI Context Contextual Helper */}
            {contactDetails.ai_context && (
              <div  style={styles.aiContextBlock}>
                <div style={styles.aiContextTitle}>
                  
                  <span>Synthèse IA (Mistral)</span>
                </div>
                <p style={styles.aiContextText}>{contactDetails.ai_context}</p>
              </div>
            )}

            {/* Contact Details (Mail/Phone) */}
            <div style={styles.infoBlock}>
              <h4 style={styles.blockTitle}>Coordonnées</h4>
              <div style={styles.detailsList}>
                {contactDetails.email && (
                  <div style={styles.detailsItem}>
                    
                    <span style={styles.detailsText}>{contactDetails.email}</span>
                  </div>
                )}
                {contactDetails.phone && (
                  <div style={styles.detailsItem}>
                    
                    <span style={styles.detailsText}>{contactDetails.phone}</span>
                  </div>
                )}
                {contactDetails.linkedin && (
                  <a href={contactDetails.linkedin} target="_blank" rel="noreferrer" style={styles.linkedinLink}>
                    
                    Profil LinkedIn
                  </a>
                )}
              </div>
            </div>

            {/* Appartenance aux Galaxies (Multi-liaison) */}
            <div style={styles.infoBlock}>
              <div style={styles.blockTitleHeader}>
                
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
                        <span>{s.name} ({s.type === 'personal' ? '� Perso' : '� Partagé'})</span>
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
                  {updatingSpaces ? "Enregistrement..." : "Valider l'Appartenance �"}
                </button>
              </div>
            </div>

            {/* Fusion de Galaxies (Partage d'Espace) */}
            <div style={styles.infoBlock}>
              <div style={styles.blockTitleHeader}>
                
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
                      {sendingInvite ? "Envoi de la demande..." : "Envoyer l'invitation de fusion "}
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Direct Connections / Relais de contact */}
            <div style={styles.infoBlock}>
              <div style={styles.blockTitleHeader}>
                
                <h4 style={styles.blockTitle}>Connexions Directes ({directConnections.length})</h4>
              </div>
              <div style={styles.connectionsContainer}>
                {directConnections.length === 0 ? (
                  <span style={styles.emptyText}>Aucune connexion directe détectée dans le graphe.</span>
                ) : (
                  directConnections.map(({ contact, reason, type }) => {
                    const spaceIndex = spaces.findIndex(s => s.id === contact.space_id);
                    const colors = ['#4F8EF7', '#9F61E8', '#EC6F8B', '#30C060', '#D4A030', '#E89030'];
                    const color = colors[spaceIndex % colors.length] || '#9F61E8';
                    
                    return (
                      <div 
                        key={contact.id} 
                        className="connection-item"
                        style={styles.connectionCard}
                        onClick={() => {
                          const graphNode = graphData.nodes.find(n => n.id === contact.id);
                          if (graphNode) {
                            setSelectedNode(graphNode);
                          }
                        }}
                      >
                        <div style={{ ...styles.avatarSmall, borderColor: color }}>
                          
                        </div>
                        <div style={styles.connectionDetails}>
                          <span style={styles.connectionName}>{contact.first_name} {contact.last_name}</span>
                          <span style={styles.connectionReason}>
                            {type === 'company' ? '� ' : '�️ '}
                            {reason}
                          </span>
                        </div>
                        
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Synergy Connections (IA) */}
            <div style={styles.infoBlock}>
              <div style={styles.blockTitleHeader}>
                
                <h4 style={styles.blockTitle}>Synergies IA (Mistral)</h4>
              </div>
              
              {!isMistralConfigured() ? (
                <div style={styles.synergyNotice}>
                  
                  <span style={styles.emptyText}>Clé Mistral requise pour activer l'Oracle.</span>
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
                  
                  Détecter les Synergies IA
                </button>
              ) : null}

              {loadingSynergies && (
                <div style={styles.synergyLoading}>
                  <div className="orbit-spinner" style={{ width: 24, height: 24 }}></div>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Calcul cosmique des synergies...</span>
                </div>
              )}

              {synergyError && (
                <span style={{ fontSize: '0.75rem', color: '#fff' }}>{synergyError}</span>
              )}

              {hasSearchedSynergies && !loadingSynergies && (
                <div style={styles.synergiesContainer}>
                  {synergies.length === 0 ? (
                    <span style={styles.emptyText}>Aucune synergie évidente détectée pour ce profil.</span>
                  ) : (
                    synergies.map((syn, idx) => (
                      <div key={idx} className="glass-card" style={styles.synergySubCard}>
                        <div style={styles.synergyCardHeader}>
                          <h5 style={styles.synergyCardTitle}>{syn.title}</h5>
                        </div>
                        <p style={styles.synergyDesc}>{syn.description}</p>
                        
                        <div 
                          className="synergy-party"
                          style={styles.synergyParty}
                          onClick={() => {
                            const graphNode = graphData.nodes.find(n => n.id === syn.targetContact.id);
                            if (graphNode) {
                              setSelectedNode(graphNode);
                            }
                          }}
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
                            <p style={{ ...styles.synergyBoxText, color: '#fff' }}>{syn.recommendedIntroPath}</p>
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

            {/* Web Enrichment Tool (Scraping) */}
            <div style={styles.enrichmentBlock}>
              {!showEnrichForm ? (
                <button 
                  onClick={() => setShowEnrichForm(true)} 
                  className="btn-primary" 
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                >
                  
                  Enrichir par le Web �
                </button>
              ) : (
                <div className="glass-panel" style={styles.enrichForm}>
                  <h5 style={styles.formTitle}>Coller du contenu public</h5>
                  <p style={styles.formDesc}>Collez le résumé LinkedIn, des extraits de son site web ou son parcours pour que Mistral l'analyse.</p>
                  <textarea
                    value={scrapedText}
                    onChange={(e) => setScrapedText(e.target.value)}
                    placeholder="Ex: Alice Martin est ingénieur diplômée... Fondatrice de GreenTech en 2024. Expertise en gestion carbone, blockchain, climatetech..."
                    style={styles.textarea}
                    rows={4}
                  />
                  <div style={styles.formActions}>
                    <button 
                      onClick={handleEnrichProfile} 
                      disabled={enriching}
                      className="btn-primary" 
                      style={styles.formSubmitBtn}
                    >
                      {enriching ? 'Analyse IA en cours...' : 'Lancer l\'enrichissement'}
                    </button>
                    <button 
                      onClick={() => setShowEnrichForm(false)} 
                      className="btn-secondary"
                      style={{ padding: '8px 12px', fontSize: '0.85rem' }}
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Interaction Notes */}
            <div style={styles.infoBlock}>
              <div style={styles.blockTitleHeader}>
                
                <h4 style={styles.blockTitle}>Historique d'échanges</h4>
              </div>
              <div style={styles.notesContainer}>
                {contactDetails.notes.length === 0 ? (
                  <span style={styles.emptyText}>Aucun échange noté.</span>
                ) : (
                  contactDetails.notes.map((n: any) => (
                    <div key={n.id} style={styles.noteCard}>
                      <div style={styles.noteCardHeader}>
                        
                        <span style={styles.noteCardDate}>
                          {new Date(n.created_at).toLocaleDateString('fr-FR')}
                        </span>
                      </div>
                      <p style={styles.noteCardContent}>{n.content}</p>
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
    width: '100%',
    height: '100%',
    position: 'relative',
    display: 'flex',
  },
  canvasContainer: {
    flexGrow: 1,
    height: '100%',
    outline: 'none',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    height: '100%',
    color: 'var(--text-secondary)',
    textAlign: 'center',
    padding: 20,
    zIndex: 1,
  },
  drawer: {
    width: 380,
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    position: 'absolute',
    right: 0,
    top: 0,
    boxShadow: '-8px 0 32px rgba(0,0,0,0.4)',
    borderLeft: '1px solid var(--border-glow)',
    borderRight: 'none',
    zIndex: 20,
  },
  drawerHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 24px',
    borderBottom: '1px solid var(--border-glow)',
  },
  drawerTitle: {
    fontSize: '1.1rem',
    fontWeight: 700,
    fontFamily: 'var(--font-display)',
    letterSpacing: '-0.01em',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    padding: 4,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'var(--transition-smooth)',
  },
  drawerContent: {
    padding: '24px',
    display: 'flex',
    flexDirection: 'column',
    gap: 24,
    overflowY: 'auto',
    flexGrow: 1,
  },
  profileSection: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    gap: 12,
  },
  avatarBig: {
    width: 80,
    height: 80,
    borderRadius: '50%',
    background: 'rgba(255, 255, 255, 0.04)',
    border: '2px solid var(--neon-purple)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    boxShadow: '0 0 20px rgba(159, 97, 232, 0.2)',
  },
  profileName: {
    fontSize: '1.5rem',
    fontWeight: 700,
    color: '#fff',
  },
  profileRole: {
    display: 'flex',
    alignItems: 'center',
    fontSize: '0.85rem',
    color: 'var(--text-secondary)',
  },
  profileLocation: {
    display: 'flex',
    alignItems: 'center',
    fontSize: '0.8rem',
    color: 'var(--text-muted)',
  },
  infoBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  blockTitleHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
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
    gap: 8,
  },
  tag: {
    padding: '4px 10px',
    borderRadius: 99,
    fontSize: '0.75rem',
    fontWeight: 600,
    border: '1px solid transparent',
  },
  bioText: {
    fontSize: '0.85rem',
    color: 'var(--text-secondary)',
    lineHeight: 1.6,
  },
  aiContextBlock: {
    background: 'rgba(159, 97, 232, 0.05)',
    border: '1px solid rgba(159, 97, 232, 0.2)',
    borderRadius: 12,
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  aiContextTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: '0.8rem',
    fontWeight: 700,
    color: '#fff',
  },
  aiContextText: {
    fontSize: '0.825rem',
    color: 'var(--text-primary)',
    lineHeight: 1.5,
  },
  detailsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  detailsItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  detailsText: {
    fontSize: '0.85rem',
    color: 'var(--text-secondary)',
  },
  linkedinLink: {
    display: 'inline-flex',
    alignItems: 'center',
    fontSize: '0.85rem',
    color: '#fff',
    textDecoration: 'none',
    fontWeight: 500,
  },
  enrichmentBlock: {
    marginTop: 10,
  },
  enrichForm: {
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  formTitle: {
    fontSize: '0.9rem',
    fontWeight: 700,
  },
  formDesc: {
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
    lineHeight: 1.4,
  },
  textarea: {
    background: 'rgba(0, 0, 0, 0.2)',
    border: '1px solid var(--border-glow)',
    borderRadius: 8,
    padding: 10,
    color: '#fff',
    fontSize: '0.85rem',
    outline: 'none',
    resize: 'none',
  },
  formActions: {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
  },
  formSubmitBtn: {
    padding: '8px 14px',
    fontSize: '0.85rem',
    flexGrow: 1,
  },
  notesContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  noteCard: {
    background: 'rgba(255, 255, 255, 0.02)',
    border: '1px solid rgba(255, 255, 255, 0.04)',
    borderRadius: 8,
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  noteCardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  noteCardDate: {
    fontSize: '0.7rem',
    color: 'var(--text-muted)',
  },
  noteCardContent: {
    fontSize: '0.825rem',
    color: 'var(--text-secondary)',
    lineHeight: 1.4,
  },
  emptyText: {
    fontSize: '0.8rem',
    color: 'var(--text-muted)',
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
  connectionArrow: {
    marginLeft: 8,
    flexShrink: 0,
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
  synergyCardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
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
    color: '#fff',
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
  selectSmall: {
    background: 'rgba(0,0,0,0.3)',
    border: '1px solid var(--border-glow)',
    borderRadius: 6,
    padding: '6px 10px',
    color: '#fff',
    outline: 'none',
    fontSize: '0.8rem',
    width: '100%',
  },
  inputSmall: {
    background: 'rgba(0,0,0,0.3)',
    border: '1px solid var(--border-glow)',
    borderRadius: 6,
    padding: '6px 10px',
    color: '#fff',
    outline: 'none',
    fontSize: '0.8rem',
    width: '100%',
  },
  searchPanel: {
    position: 'absolute',
    left: 20,
    top: 20,
    width: 260,
    maxHeight: 'calc(100vh - 120px)',
    display: 'flex',
    flexDirection: 'column',
    padding: 16,
    zIndex: 10,
    gap: 12,
    boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
    border: '1px solid var(--border-glow)',
  },
  searchHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  searchTitle: {
    fontSize: '0.8rem',
    fontWeight: 700,
    color: '#fff',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  searchInput: {
    background: 'rgba(0, 0, 0, 0.3)',
    border: '1px solid var(--border-glow)',
    borderRadius: 8,
    padding: '8px 12px',
    color: '#fff',
    fontSize: '0.85rem',
    outline: 'none',
  },
  searchList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    overflowY: 'auto',
    flexGrow: 1,
    paddingRight: 2,
  },
  searchItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    padding: '8px 10px',
    border: '1px solid transparent',
    borderRadius: 6,
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'var(--transition-smooth)',
  },
  itemName: {
    fontSize: '0.8rem',
    fontWeight: 600,
    color: '#fff',
  },
  itemCompany: {
    fontSize: '0.7rem',
    color: 'var(--text-secondary)',
  },
  noResultsText: {
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
    fontStyle: 'italic',
    textAlign: 'center',
    padding: 10,
  },
};
