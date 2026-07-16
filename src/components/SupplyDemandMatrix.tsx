import React, { useMemo, useState } from 'react';
import { Star } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SupplyDemandEntry {
  /** The need / topic being matched */
  need: string;
  /** Concrete 2-3 sentence explanation: who needs what, who can supply, first step */
  rationale?: string;
  /** People who want this */
  demanders: { id: string; name: string }[];
  /** People who can provide this */
  suppliers: { id: string; name: string }[];
  /** How well the need is covered */
  gapLevel: 'covered' | 'partial' | 'opportunity';
  /** Whether this row represents an opportunity for the current user */
  opportunityForUser: boolean;
}

export interface SupplyDemandMatrixProps {
  /** Array of supply/demand entries to display */
  data: SupplyDemandEntry[];
  /** The current user's display name */
  userName?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const GAP_ORDER: Record<string, number> = {
  opportunity: 0,
  partial: 1,
  covered: 2,
};

const GAP_LABEL: Record<string, string> = {
  opportunity: 'Opportunité',
  partial: 'Partiel',
  covered: 'Couvert',
};

function sortEntries(entries: SupplyDemandEntry[]): SupplyDemandEntry[] {
  return [...entries].sort((a, b) => {
    // Opportunities for user first
    if (a.opportunityForUser !== b.opportunityForUser) {
      return a.opportunityForUser ? -1 : 1;
    }
    // Then by gap severity
    return (GAP_ORDER[a.gapLevel] ?? 99) - (GAP_ORDER[b.gapLevel] ?? 99);
  });
}

// ─── Gap-level style helpers (monochrome intensity, not hue) ─────────────────

function gapBorderLeft(level: string): string {
  switch (level) {
    case 'opportunity':
      return '3px solid var(--accent)';
    case 'partial':
      return '3px solid var(--border-hover)';
    case 'covered':
    default:
      return '3px solid var(--border)';
  }
}

function gapBadgeStyle(level: string): React.CSSProperties {
  const base: React.CSSProperties = {
    display: 'inline-block',
    padding: '3px 10px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    fontFamily: 'var(--font-mono)',
  };

  switch (level) {
    case 'opportunity':
      return { ...base, background: 'var(--accent)', color: '#ffffff' };
    case 'partial':
      return { ...base, background: 'rgba(27, 23, 37, 0.08)', color: 'var(--text-primary)', border: '1px solid var(--border-hover)' };
    case 'covered':
    default:
      return { ...base, background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)' };
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * SupplyDemandMatrix — a clean, monochrome table cross-referencing detected
 * needs with who demands them and who can supply them, ranked by gap
 * severity (biggest opportunities for the user first).
 */
export const SupplyDemandMatrix: React.FC<SupplyDemandMatrixProps> = ({
  data,
  userName,
}) => {
  const sorted = useMemo(() => sortEntries(data), [data]);
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);

  // ── Styles ───────────────────────────────────────────────────────────────

  const wrapperStyle: React.CSSProperties = {
    width: '100%',
    overflowX: 'auto',
    borderRadius: 10,
    border: '1px solid var(--border)',
    background: 'var(--bg-card)',
  };

  const tableStyle: React.CSSProperties = {
    width: '100%',
    borderCollapse: 'collapse',
    fontFamily: 'inherit',
    fontSize: 13,
    minWidth: 640,
  };

  const thStyle: React.CSSProperties = {
    padding: '12px 16px',
    textAlign: 'left',
    fontWeight: 600,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: 'var(--text-muted)',
    borderBottom: '1px solid var(--border)',
    whiteSpace: 'nowrap',
  };

  const tdBase: React.CSSProperties = {
    padding: '12px 16px',
    verticalAlign: 'top',
    borderBottom: '1px solid var(--border)',
    transition: 'background-color 0.15s ease',
  };

  const nameChipStyle = (highlighted: boolean): React.CSSProperties => ({
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 6,
    fontSize: 12,
    marginRight: 4,
    marginBottom: 3,
    background: highlighted ? 'rgba(27, 23, 37, 0.08)' : 'rgba(27, 23, 37, 0.04)',
    color: highlighted ? 'var(--text-primary)' : 'var(--text-secondary)',
    border: highlighted ? '1px solid var(--border-hover)' : '1px solid var(--border)',
    transition: 'all 0.15s ease',
  });

  const emptyHintStyle: React.CSSProperties = {
    color: 'var(--text-muted)',
    fontStyle: 'italic',
    fontSize: 12,
  };

  // ── Empty state ──────────────────────────────────────────────────────────

  if (sorted.length === 0) {
    return (
      <div
        style={{
          ...wrapperStyle,
          padding: 40,
          textAlign: 'center',
          color: 'var(--text-muted)',
          fontSize: 14,
        }}
      >
        Aucune donnée offre / demande disponible. Lancez l'analyse pour peupler cette matrice.
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={wrapperStyle}>
      {userName && (
        <div
          style={{
            padding: '14px 16px 0',
            fontSize: 12,
            color: 'var(--text-secondary)',
          }}
        >
          Offre & demande du réseau pour <strong style={{ color: 'var(--text-primary)' }}>{userName}</strong>
        </div>
      )}

      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>Besoin</th>
            <th style={thStyle}>Demandeurs</th>
            <th style={thStyle}>Fournisseurs</th>
            <th style={{ ...thStyle, textAlign: 'center' }}>Statut</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((entry, idx) => {
            const isHovered = hoveredRow === idx;

            const rowStyle: React.CSSProperties = {
              background: isHovered ? 'rgba(27, 23, 37, 0.03)' : 'transparent',
              borderLeft: gapBorderLeft(entry.gapLevel),
              cursor: 'default',
            };

            return (
              <tr
                key={idx}
                style={rowStyle}
                onMouseEnter={() => setHoveredRow(idx)}
                onMouseLeave={() => setHoveredRow(null)}
              >
                {/* Need */}
                <td style={{ ...tdBase, fontWeight: 500, color: 'var(--text-primary)', maxWidth: 320 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {entry.need}
                    {entry.opportunityForUser && (
                      <Star size={13} fill="var(--accent)" color="var(--accent)" aria-label="Opportunité pour vous" />
                    )}
                  </span>
                  {entry.rationale && (
                    <span style={{ display: 'block', marginTop: 5, fontWeight: 400, fontSize: 12, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
                      {entry.rationale}
                    </span>
                  )}
                </td>

                {/* Demanders */}
                <td style={tdBase}>
                  {entry.demanders.length === 0 ? (
                    <span style={emptyHintStyle}>Aucun</span>
                  ) : (
                    entry.demanders.map((d) => (
                      <span key={d.id} style={nameChipStyle(isHovered)}>
                        {d.name}
                      </span>
                    ))
                  )}
                </td>

                {/* Suppliers */}
                <td style={tdBase}>
                  {entry.suppliers.length === 0 ? (
                    <span style={emptyHintStyle}>Aucun — écart</span>
                  ) : (
                    entry.suppliers.map((s) => (
                      <span key={s.id} style={nameChipStyle(isHovered)}>
                        {s.name}
                      </span>
                    ))
                  )}
                </td>

                {/* Status badge */}
                <td style={{ ...tdBase, textAlign: 'center' }}>
                  <span style={gapBadgeStyle(entry.gapLevel)}>
                    {GAP_LABEL[entry.gapLevel] ?? entry.gapLevel}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default SupplyDemandMatrix;
