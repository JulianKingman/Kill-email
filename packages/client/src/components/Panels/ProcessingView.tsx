import { useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import { ProcessingPhase } from '@kill-email/shared';
import { playSelect } from '../../utils/sounds';

export function ProcessingView() {
  const {
    phase,
    progress,
    stats,
    terminalLines,
    setView,
    addTerminalLine,
    setSessionId,
    reset,
  } = useAppStore();

  const [dryRun, setDryRun] = useState(true);
  const [limit, setLimit] = useState(50);
  const [started, setStarted] = useState(false);

  const startProcessing = async () => {
    reset();
    setStarted(true);
    addTerminalLine('Initiating termination protocol...', 'system');

    try {
      const res = await fetch('/api/process/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: 'INBOX', limit, dryRun }),
      });
      const data = await res.json();
      if (data.sessionId) {
        setSessionId(data.sessionId);
        addTerminalLine(`Session started: ${data.sessionId}`, 'info');
      }
    } catch (err) {
      addTerminalLine('Failed to start processing', 'error');
      setStarted(false);
    }
  };

  const getPhaseMessage = (p: ProcessingPhase): string => {
    const messages: Record<ProcessingPhase, string> = {
      [ProcessingPhase.INITIALIZING]: 'INITIALIZING NEURAL NETWORK...',
      [ProcessingPhase.CONNECTING]: 'ESTABLISHING CONNECTION...',
      [ProcessingPhase.SCANNING]: 'SCANNING FOR TARGETS...',
      [ProcessingPhase.CATEGORIZING]: 'ANALYZING TARGETS...',
      [ProcessingPhase.ESCALATING]: 'ESCALATING COMPLEX CASES...',
      [ProcessingPhase.REVIEWING]: 'AWAITING HUMAN REVIEW...',
      [ProcessingPhase.EXECUTING]: 'EXECUTING TERMINATION PROTOCOL...',
      [ProcessingPhase.COMPLETE]: 'MISSION COMPLETE',
      [ProcessingPhase.ERROR]: 'SYSTEM ERROR',
    };
    return messages[p] || 'PROCESSING...';
  };

  return (
    <div className="processing-view">
      {!started ? (
        <div className="processing-setup">
          <div className="setup-header">
            [ TERMINATION SETTINGS ]
          </div>

          <div className="setup-options">
            <div className="option-row">
              <label>
                <input
                  type="checkbox"
                  checked={dryRun}
                  onChange={(e) => { playSelect(); setDryRun(e.target.checked); }}
                />
                DRY RUN MODE (preview only, no changes)
              </label>
            </div>

            <div className="option-row">
              <label>
                Email limit:
                <input
                  type="number"
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value))}
                  min={1}
                  max={500}
                />
              </label>
            </div>
          </div>

          <div className="setup-actions">
            <button className="btn-primary" onClick={() => { playSelect(); startProcessing(); }}>
              [X] BEGIN TERMINATION
            </button>
            <button className="btn-secondary" onClick={() => { playSelect(); setView('menu'); }}>
              {'<'}- BACK
            </button>
          </div>
        </div>
      ) : (
        <div className="processing-active">
          <div className="phase-display">
            <div className="phase-label">{getPhaseMessage(phase)}</div>
            {progress.total > 0 && (
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                />
                <span className="progress-text">
                  {progress.current} / {progress.total}
                </span>
              </div>
            )}
          </div>

          <div className="terminal-output">
            {terminalLines.slice(-20).map((line) => (
              <div key={line.id} className={`terminal-line ${line.type}`}>
                <span className="line-prefix">
                  {line.type === 'error' ? '[!]' : line.type === 'success' ? '[+]' : '>>>'}
                </span>
                {line.text}
              </div>
            ))}
          </div>

          {phase === ProcessingPhase.COMPLETE && (
            <div className="mission-report">
              <div className="report-header">═══ MISSION REPORT ═══</div>
              <div className="report-stats">
                <div>TARGETS SCANNED: {stats.totalEmails}</div>
                <div>TERMINATED: {stats.terminated}</div>
                <div>ARCHIVED: {stats.archived}</div>
                <div>PRESERVED: {stats.kept}</div>
                <div>BYTES FREED: {formatBytes(stats.bytesFreed)}</div>
              </div>
              <button className="btn-primary" onClick={() => { reset(); setStarted(false); }}>
                NEW MISSION
              </button>
              <button className="btn-secondary" onClick={() => setView('menu')}>
                {'<'}- MAIN MENU
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
