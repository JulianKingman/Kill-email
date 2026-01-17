import { useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import { playSelect, playHover } from '../../utils/sounds';

interface MenuItem {
  id: string;
  icon: string;
  label: string;
  action: () => void;
  disabled?: boolean;
}

export function MainMenu() {
  const { setView, config, addTerminalLine } = useAppStore();
  const [selectedIndex, setSelectedIndex] = useState(0);

  const items: MenuItem[] = [
    {
      id: 'terminate',
      icon: '[X]',
      label: 'TERMINATE INBOX',
      action: () => {
        if (!config?.status.ready) {
          addTerminalLine('ERROR: Configure email and API key first', 'error');
          return;
        }
        setView('processing');
      },
      disabled: !config?.status.ready,
    },
    {
      id: 'config',
      icon: '[=]',
      label: 'Configure Settings',
      action: () => setView('config'),
    },
    {
      id: 'email',
      icon: '[@]',
      label: 'Setup Email Connection',
      action: () => setView('email'),
    },
    {
      id: 'api',
      icon: '[*]',
      label: 'Set API Key',
      action: async () => {
        const key = prompt('Enter Anthropic API Key:');
        if (key) {
          try {
            await fetch('/api/process/llm/setup', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ apiKey: key }),
            });
            addTerminalLine('API key configured successfully', 'success');
            // Refresh config
            const res = await fetch('/api/config');
            const newConfig = await res.json();
            useAppStore.getState().setConfig(newConfig);
          } catch {
            addTerminalLine('Failed to set API key', 'error');
          }
        }
      },
    },
    {
      id: 'stats',
      icon: '[#]',
      label: 'View Statistics',
      action: () => addTerminalLine('Statistics view coming soon...', 'info'),
    },
  ];

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp') {
      playHover();
      setSelectedIndex((i) => (i > 0 ? i - 1 : items.length - 1));
    } else if (e.key === 'ArrowDown') {
      playHover();
      setSelectedIndex((i) => (i < items.length - 1 ? i + 1 : 0));
    } else if (e.key === 'Enter') {
      const item = items[selectedIndex];
      if (!item.disabled) {
        playSelect();
        item.action();
      }
    }
  };

  return (
    <div className="main-menu" tabIndex={0} onKeyDown={handleKeyDown}>
      <div className="menu-header">
        [ MAIN TERMINAL ]
      </div>

      <div className="menu-status">
        <span className={config?.status.emailConfigured ? 'status-ok' : 'status-warn'}>
          EMAIL: {config?.status.emailConfigured ? '[OK] CONFIGURED' : '[--] NOT SET'}
        </span>
        <span className={config?.status.llmConfigured ? 'status-ok' : 'status-warn'}>
          API: {config?.status.llmConfigured ? '[OK] CONFIGURED' : '[--] NOT SET'}
        </span>
      </div>

      <div className="menu-items">
        <div className="menu-prompt">► Select mission:</div>
        {items.map((item, index) => (
          <div
            key={item.id}
            className={`menu-item ${index === selectedIndex ? 'selected' : ''} ${item.disabled ? 'disabled' : ''}`}
            onClick={() => {
              setSelectedIndex(index);
              if (!item.disabled) {
                playSelect();
                item.action();
              }
            }}
            onMouseEnter={() => {
              if (index !== selectedIndex) {
                playHover();
                setSelectedIndex(index);
              }
            }}
          >
            <span className="menu-cursor">{index === selectedIndex ? '>' : ' '}</span>
            <span className="menu-icon">{item.icon}</span>
            <span className="menu-label">{item.label}</span>
            {item.disabled && <span className="menu-disabled">(setup required)</span>}
          </div>
        ))}
      </div>

      <div className="menu-help">
        Use UP/DOWN arrows to navigate, ENTER to select
      </div>
    </div>
  );
}
