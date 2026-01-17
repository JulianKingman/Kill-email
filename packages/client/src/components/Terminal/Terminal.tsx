import { useEffect } from 'react';
import { useAppStore } from '../../stores/appStore';
import { useWebSocket } from '../../hooks/useWebSocket';
import { Logo } from '../UI/Logo';
import { MainMenu } from '../Panels/MainMenu';
import { ProcessingView } from '../Panels/ProcessingView';
import { ConfigPanel } from '../Panels/ConfigPanel';
import { EmailSetup } from '../Panels/EmailSetup';

export function Terminal() {
  const { currentView, theme, addTerminalLine } = useAppStore();

  // Connect WebSocket
  useWebSocket();

  useEffect(() => {
    addTerminalLine('SYSTEM ONLINE', 'system');
    addTerminalLine('Neural network initialized...', 'info');
  }, []);

  return (
    <div className={`terminal theme-${theme}`}>
      <Logo />

      <div className="terminal-content">
        {currentView === 'menu' && <MainMenu />}
        {currentView === 'processing' && <ProcessingView />}
        {currentView === 'config' && <ConfigPanel />}
        {currentView === 'email' && <EmailSetup />}
      </div>
    </div>
  );
}
