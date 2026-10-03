import { useState, useEffect } from 'react';
import { useAppStore } from '../../stores/appStore';
import { playSelect, playHover } from '../../utils/sounds';

interface Preset {
  id: string;
  name: string;
  description: string;
}

export function ConfigPanel() {
  const { setView, addTerminalLine, setTheme, theme, crtEnabled, setCrtEnabled } = useAppStore();
  const [presets, setPresets] = useState<Preset[]>([]);
  const [selectedPreset, setSelectedPreset] = useState('balanced');

  useEffect(() => {
    fetch('/api/config/presets')
      .then((res) => res.json())
      .then(setPresets)
      .catch(console.error);
  }, []);

  const applyPreset = async () => {
    try {
      await fetch('/api/config/preset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset: selectedPreset }),
      });
      addTerminalLine(`Preset "${selectedPreset}" applied`, 'success');
    } catch {
      addTerminalLine('Failed to apply preset', 'error');
    }
  };

  return (
    <div className="config-panel">
      <div className="panel-header">
        [ CONFIGURATION ]
      </div>

      <div className="config-section">
        <h3>BEHAVIOR PRESET</h3>
        <div className="preset-list">
          {presets.map((preset) => (
            <div
              key={preset.id}
              className={`preset-item ${selectedPreset === preset.id ? 'selected' : ''}`}
              onClick={() => { playSelect(); setSelectedPreset(preset.id); }}
              onMouseEnter={() => playHover()}
            >
              <span className="preset-cursor">{selectedPreset === preset.id ? '►' : ' '}</span>
              <span className="preset-name">{preset.name}</span>
              <span className="preset-desc">{preset.description}</span>
            </div>
          ))}
        </div>
        <button className="btn-secondary" onClick={() => { playSelect(); applyPreset(); }}>
          APPLY PRESET
        </button>
      </div>

      <div className="config-section">
        <h3>VISUAL THEME</h3>
        <div className="theme-options">
          {([
            { id: 'terminator', label: 'TERMINATOR', bg: '#0a0a0a', fg: '#ff3333' },
            { id: 'matrix', label: 'MATRIX', bg: '#0a0a0a', fg: '#00ff00' },
            { id: 'amber', label: 'AMBER', bg: '#0a0a0a', fg: '#ffaa00' },
            { id: 'amber-light', label: 'AMBER LIGHT', bg: '#ffcc66', fg: '#1a1a00' },
            { id: 'green', label: 'GREEN', bg: '#0a0a0a', fg: '#33ff33' },
          ] as const).map((t) => (
            <button
              key={t.id}
              className={`theme-btn ${theme === t.id ? 'active' : ''}`}
              style={{
                background: t.bg,
                color: t.fg,
                borderColor: t.fg,
              }}
              onClick={() => { playSelect(); setTheme(t.id); }}
              onMouseEnter={() => playHover()}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="config-section">
        <h3>CRT EFFECTS</h3>
        <label className="toggle-option">
          <input
            type="checkbox"
            checked={crtEnabled}
            onChange={(e) => { playSelect(); setCrtEnabled(e.target.checked); }}
          />
          Enable CRT scanline & bloom effects
        </label>
      </div>

      <div className="config-actions">
        <button className="btn-primary" onClick={() => { playSelect(); setView('menu'); }}>
          {'<'}- BACK TO MAIN
        </button>
      </div>
    </div>
  );
}
