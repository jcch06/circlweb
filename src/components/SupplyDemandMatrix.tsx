import React, { useMemo, useState } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SupplyDemandEntry {
  /** The need / topic being matched */
  need: string;
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

/** Inline keyframe injection (runs once). */
let stylesInjected = false;
function injectKeyframes(): void {
  if (stylesInjected || typeof document === 'undefined') return;
  stylesInjected = true;

  const style = document.createElement('style');
  style.textContent = `
    @keyframes sdm-pulse-opportunity {
      0%, 100% { box-shadow: 0 0 4px 1px var(--neon-purple, #a855f7); }
      50% { box-shadow: 0 0 14px 4px var(--neon-purple, #a855f7); }
    }
    @keyframes sdm-badge-glow {
      0%, 100% { text-shadow: 0 0 4px var(--neon-yellow, #eab308); }
      50% { text-shadow: 0 0 10px var(--neon-yellow, #eab308); }
    }
    @keyframes sdm-fade-in {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0); }
    }
  `;
  document.head.appendChild(style);
}

// ─── Gap-level colour helpers ────────────────────────────────────────────────

function gapBg(level: string): string {
  switch (level) {
    case 'covered':
      return 'rgba(34,197,94,0.08)';
    case 'partial':
      return 'rgba(234,179,8,0.08)';
    case 'opportunity':
      return 'rgba(168,85,247,0.10)';
    default:
      return 'transparent';
  }
}

function gapBorderLeft(level: string): string {
  switch (level) {
    case 'covered':
      return '3px solid var(--neon-green, #22c55e)';
    case 'partial':
      return '3px solid var(--neon-yellow, #eab308)';
    case 'opportunity':
      return '3px solid var(--neon-purple, #a855f7)';
    default:
      return '3px solid transparent';
  }
}

function gapBadgeStyle(level: string): React.CSSProperties {
  const base: React.CSSProperties = {
    display: 'inline-block',
    padding: '2px 10px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 0.3,
    textTransform: 'uppercase' as const,
  };

  switch (level) {
    case 'covered':
      return {
        ...base,
        background: 'rgba(34,197,94,0.15)',
        color: 'var(--neon-green, #22c55e)',
        border: '1px solid rgba(34,197,94,0.3)',
      };
    case 'partial':
      return {
        ...base,
        background: 'rgba(234,179,8,0.15)',
        color: 'var(--neon-yellow, #eab308)',
        border: '1px solid rgba(234,179,8,0.3)',
      };
    case 'opportunity':
      return {
        ...base,
        background: 'rgba(168,85,247,0.15)',
        color: 'var(--neon-purple, #a855f7)',
        border: '1px solid rgba(168,85,247,0.3)',
        animation: 'sdm-pulse-opportunity 2.5s ease-in-out infinite',
      };
    default:
      return base;
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * SupplyDemandMatrix — an interactive, glassmorphism-styled table that displays
 * supply/demand matches, color-coded by gap level, with hover highlights and
 * opportunity badges.
 */
export const SupplyDemandMatrix: React.FC<SupplyDemandMatrixProps> = ({
  data,
  userName,
}) => {
  injectKeyframes();
  const sorted = useMemo(() => sortEntries(data), [data]);
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);

  // ── Styles ───────────────────────────────────────────────────────────────

  const wrapperStyle: React.CSSProperties = {
    width: '100%',
    overflowX: 'auto',
    borderRadius: 14,
    border: '1px solid rgba(168,85,247,0.12)',
    background:
      '#ffffff',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
  };

  const tableStyle: React.CSSProperties = {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontFamily: 'inherit',
    fontSize: 13,
  };

  const thStyle: React.CSSProperties = {
    padding: '12px 16px',
    textAlign: 'left' as const,
    fontWeight: 600,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase' as const,
    color: 'var(--text-secondary, #aaa)',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    whiteSpace: 'nowrap' as const,
  };

  const tdBase: React.CSSProperties = {
    padding: '10px 16px',
    verticalAlign: 'top' as const,
    borderBottom: '1px solid rgba(255,255,255,0.04)',
    transition: 'background 0.2s ease',
  };

  const nameChipStyle = (highlighted: boolean): React.CSSProperties => ({
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 6,
    fontSize: 12,
    marginRight: 4,
    marginBottom: 3,
    background: highlighted
      ? 'rgba(59,130,246,0.18)'
      : 'rgba(255,255,255,0.05)',
    color: highlighted
      ? 'var(--neon-blue, #3b82f6)'
      : 'var(--text-secondary, #aaa)',
    border: highlighted
      ? '1px solid rgba(59,130,246,0.3)'
      : '1px solid rgba(255,255,255,0.08)',
    transition: 'all 0.2s ease',
  });

  const emptyHintStyle: React.CSSProperties = {
    color: 'var(--text-muted, #555)',
    fontStyle: 'italic' as const,
    fontSize: 12,
  };

  // ── Empty state ──────────────────────────────────────────────────────────

  if (sorted.length === 0) {
    return (
      <div
        style={{
          ...wrapperStyle,
          padding: 32,
          textAlign: 'center',
          color: 'var(--text-muted, #555)',
          fontSize: 14,
        }}
      >
        No supply/demand data available yet. Run the analysis to populate this
        matrix.
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={wrapperStyle}>
      {userName && (
        <div
          style={{
            padding: '12px 16px 4px',
            fontSize: 12,
            color: 'var(--text-secondary, #aaa)',
          }}
        >
          Showing network supply & demand for{' '}
          <strong style={{ color: 'var(--neon-blue, #3b82f6)' }}>
            {userName}
          </strong>
        </div>
      )}

      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>Need / Topic</th>
            <th style={thStyle}>Demanders</th>
            <th style={thStyle}>Suppliers</th>
            <th style={{ ...thStyle, textAlign: 'center' as const }}>
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((entry, idx) => {
            const isHovered = hoveredRow === idx;

            const rowStyle: React.CSSProperties = {
              background: isHovered
                ? 'rgba(168,85,247,0.06)'
                : gapBg(entry.gapLevel),
              borderLeft: gapBorderLeft(entry.gapLevel),
              cursor: 'default',
              animation: 'sdm-fade-in 0.3s ease forwards',
              animationDelay: `${idx * 40}ms`,
              opacity: 0, // initial — animation fills to 1
            };

            return (
              <tr
                key={idx}
                style={rowStyle}
                onMouseEnter={() => setHoveredRow(idx)}
                onMouseLeave={() => setHoveredRow(null)}
              >
                {/* Need */}
                <td style={{ ...tdBase, fontWeight: 500, color: '#e2e2e2' }}>
                  <span>{entry.need}</span>
                  {entry.opportunityForUser && (
                    <span
                      style={{
                        marginLeft: 8,
                        animation: 'sdm-badge-glow 2s ease-in-out infinite',
                        fontSize: 14,
                      }}
                      title="Opportunity for you!"
                    >
                      ⭐
                    </span>
                  )}
                </td>

                {/* Demanders */}
                <td style={tdBase}>
                  {entry.demanders.length === 0 ? (
                    <span style={emptyHintStyle}>None</span>
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
                    <span style={emptyHintStyle}>None — gap!</span>
                  ) : (
                    entry.suppliers.map((s) => (
                      <span key={s.id} style={nameChipStyle(isHovered)}>
                        {s.name}
                      </span>
                    ))
                  )}
                </td>

                {/* Status badge */}
                <td style={{ ...tdBase, textAlign: 'center' as const }}>
                  <span style={gapBadgeStyle(entry.gapLevel)}>
                    {entry.gapLevel}
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
