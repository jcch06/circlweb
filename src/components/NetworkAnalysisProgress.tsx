import React, { useMemo } from 'react';
import { Brain, Fingerprint, Network, Target } from 'lucide-react';

/**
 * Props for NetworkAnalysisProgress.
 */
export interface NetworkAnalysisProgressProps {
  /** Current pass: 0 = not started, 1-4 = which pass is active */
  currentPass: number;
  /** 0-100 progress within the current pass */
  passProgress: number;
  /** Custom labels for each of the 4 passes */
  passLabels?: string[];
  /** Whether the entire pipeline is complete */
  isComplete: boolean;
}

const DEFAULT_LABELS = [
  'Embedding Contacts',
  'Clustering Network',
  'Mapping Supply & Demand',
  'Scoring Opportunities',
];

const STEP_ICONS = [Brain, Fingerprint, Network, Target] as const;

type StepStatus = 'pending' | 'active' | 'done';

function getStepStatus(
  stepIndex: number,
  currentPass: number,
  isComplete: boolean
): StepStatus {
  if (isComplete) return 'done';
  if (stepIndex + 1 < currentPass) return 'done';
  if (stepIndex + 1 === currentPass) return 'active';
  return 'pending';
}

/** Inline keyframe injection (runs once). */
let stylesInjected = false;
function injectKeyframes(): void {
  if (stylesInjected || typeof document === 'undefined') return;
  stylesInjected = true;

  const style = document.createElement('style');
  style.textContent = `
    @keyframes nap-pulse {
      0%, 100% { box-shadow: 0 0 8px 2px var(--neon-purple, #a855f7); }
      50% { box-shadow: 0 0 20px 6px var(--neon-purple, #a855f7); }
    }
    @keyframes nap-line-flow {
      0% { background-position: 0% 50%; }
      100% { background-position: 200% 50%; }
    }
    @keyframes nap-check-pop {
      0% { transform: scale(0); opacity: 0; }
      60% { transform: scale(1.2); opacity: 1; }
      100% { transform: scale(1); opacity: 1; }
    }
  `;
  document.head.appendChild(style);
}

/**
 * A beautiful multi-step progress indicator for the Oracle IA 4-pass pipeline.
 * Premium dark-glass aesthetic with animated glow, connecting lines, and status icons.
 */
export const NetworkAnalysisProgress: React.FC<NetworkAnalysisProgressProps> = ({
  currentPass,
  passProgress,
  passLabels,
  isComplete,
}) => {
  injectKeyframes();

  const labels = passLabels ?? DEFAULT_LABELS;

  const steps = useMemo(
    () =>
      labels.map((label, i) => ({
        label,
        Icon: STEP_ICONS[i],
        status: getStepStatus(i, currentPass, isComplete),
      })),
    [labels, currentPass, isComplete]
  );

  // ── Styles ─────────────────────────────────────────────────────────────────

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: 0,
    width: '100%',
    padding: '28px 12px 12px',
    background:
      'linear-gradient(135deg, rgba(15,15,25,0.85) 0%, rgba(25,20,45,0.75) 100%)',
    borderRadius: 16,
    border: '1px solid rgba(168,85,247,0.15)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    position: 'relative',
    overflow: 'hidden',
  };

  const stepGroupStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    flex: 1,
    minWidth: 0,
  };

  function circleStyle(status: StepStatus): React.CSSProperties {
    const base: React.CSSProperties = {
      width: 44,
      height: 44,
      minWidth: 44,
      borderRadius: '50%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'all 0.4s ease',
      position: 'relative',
      zIndex: 2,
    };

    if (status === 'done') {
      return {
        ...base,
        background: 'linear-gradient(135deg, var(--neon-green, #22c55e), #16a34a)',
        border: '2px solid var(--neon-green, #22c55e)',
        boxShadow: '0 0 12px 2px rgba(34,197,94,0.35)',
      };
    }
    if (status === 'active') {
      return {
        ...base,
        background:
          'linear-gradient(135deg, var(--neon-purple, #a855f7), var(--neon-blue, #3b82f6))',
        border: '2px solid var(--neon-purple, #a855f7)',
        animation: 'nap-pulse 2s ease-in-out infinite',
      };
    }
    // pending
    return {
      ...base,
      background: 'rgba(40,40,60,0.6)',
      border: '2px solid var(--text-muted, #555)',
    };
  }

  function iconColor(status: StepStatus): string {
    if (status === 'done') return '#fff';
    if (status === 'active') return '#fff';
    return 'var(--text-muted, #555)';
  }

  function lineStyle(status: StepStatus): React.CSSProperties {
    const base: React.CSSProperties = {
      flex: 1,
      height: 3,
      borderRadius: 2,
      alignSelf: 'center',
      marginTop: 20, // vertically center with the 44px circle
      transition: 'all 0.4s ease',
      minWidth: 12,
      zIndex: 1,
    };

    if (status === 'done') {
      return {
        ...base,
        background: 'var(--neon-green, #22c55e)',
        boxShadow: '0 0 6px rgba(34,197,94,0.3)',
      };
    }
    if (status === 'active') {
      return {
        ...base,
        background:
          'linear-gradient(90deg, var(--neon-purple, #a855f7), var(--neon-blue, #3b82f6), var(--neon-purple, #a855f7))',
        backgroundSize: '200% 100%',
        animation: 'nap-line-flow 1.5s linear infinite',
      };
    }
    return {
      ...base,
      background: 'rgba(80,80,100,0.35)',
    };
  }

  function labelStyle(status: StepStatus): React.CSSProperties {
    return {
      marginTop: 8,
      fontSize: 11,
      fontWeight: status === 'active' ? 600 : 400,
      color:
        status === 'done'
          ? 'var(--neon-green, #22c55e)'
          : status === 'active'
            ? '#fff'
            : 'var(--text-muted, #555)',
      textAlign: 'center' as const,
      lineHeight: '1.3',
      transition: 'color 0.3s ease',
      maxWidth: 90,
      wordBreak: 'break-word' as const,
    };
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={containerStyle}>
      {steps.map((step, idx) => {
        const { Icon, label, status } = step;
        // Determine the status of the connecting line AFTER this step
        const lineStatus: StepStatus | null =
          idx < steps.length - 1 ? steps[idx + 1].status : null;

        return (
          <div key={idx} style={stepGroupStyle}>
            {/* Step column */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
              }}
            >
              <div style={circleStyle(status)}>
                {status === 'done' ? (
                  <span
                    style={{
                      fontSize: 20,
                      animation: 'nap-check-pop 0.4s ease forwards',
                      color: 'var(--text-primary)',
                    }}
                  >
                    ✓
                  </span>
                ) : (
                  <Icon size={20} color={iconColor(status)} />
                )}
              </div>
              <span style={labelStyle(status)}>{label}</span>
              {status === 'active' && (
                <div
                  style={{
                    marginTop: 4,
                    fontSize: 10,
                    color: 'var(--neon-blue, #3b82f6)',
                    fontWeight: 600,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {Math.round(passProgress)}%
                </div>
              )}
            </div>

            {/* Connecting line */}
            {lineStatus !== null && (
              <div style={lineStyle(lineStatus === 'done' ? 'done' : status === 'done' ? 'active' : 'pending')} />
            )}
          </div>
        );
      })}
    </div>
  );
};

export default NetworkAnalysisProgress;
