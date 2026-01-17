import { useEffect } from 'react';
import { CRTEffect } from './components/CRT/CRTEffect';
import { Terminal } from './components/Terminal/Terminal';
import { useAppStore } from './stores/appStore';

function App() {
  const { crtEnabled, theme, fetchConfig } = useAppStore();

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  return (
    <CRTEffect enabled={crtEnabled} theme={theme}>
      <Terminal />
    </CRTEffect>
  );
}

export default App;
