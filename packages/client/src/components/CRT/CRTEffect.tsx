import { ReactNode } from 'react';
import { Theme } from '../../stores/appStore';

interface CRTEffectProps {
  children: ReactNode;
  enabled: boolean;
  theme: Theme;
}

export function CRTEffect({ children, enabled, theme }: CRTEffectProps) {
  return (
    <div className={`crt-container ${enabled ? 'crt-enabled' : ''} crt-theme-${theme}`}>
      <div className="crt-content">
        {children}
      </div>
    </div>
  );
}
