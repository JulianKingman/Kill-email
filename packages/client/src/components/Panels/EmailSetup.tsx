import { useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import { TerminalSelect } from '../UI/TerminalSelect';
import { playSelect } from '../../utils/sounds';

type Provider = 'gmail' | 'outlook' | 'yahoo' | 'custom';

const providerOptions = [
  { value: 'gmail', label: 'Gmail' },
  { value: 'outlook', label: 'Outlook / Office 365' },
  { value: 'yahoo', label: 'Yahoo Mail' },
  { value: 'custom', label: 'Custom IMAP' },
];

export function EmailSetup() {
  const { setView, addTerminalLine, fetchConfig } = useAppStore();
  const [provider, setProvider] = useState<Provider>('gmail');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState(993);
  const [testing, setTesting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      await fetch('/api/email/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          email,
          password,
          host: provider === 'custom' ? host : undefined,
          port: provider === 'custom' ? port : undefined,
        }),
      });

      addTerminalLine('Email configuration saved', 'success');
      addTerminalLine('Testing connection...', 'info');

      setTesting(true);
      const testRes = await fetch('/api/email/test', { method: 'POST' });
      const testData = await testRes.json();
      setTesting(false);

      if (testData.success) {
        addTerminalLine(`Connection successful! Found ${testData.emailCount} emails`, 'success');
        await fetchConfig();
      } else {
        addTerminalLine(`Connection failed: ${testData.error}`, 'error');
      }
    } catch (err) {
      addTerminalLine('Failed to setup email', 'error');
      setTesting(false);
    }
  };

  return (
    <div className="email-setup">
      <div className="panel-header">
        [ EMAIL CONNECTION ]
      </div>

      <form onSubmit={handleSubmit} className="setup-form">
        <div className="form-group">
          <label>PROVIDER:</label>
          <TerminalSelect
            options={providerOptions}
            value={provider}
            onChange={(val) => setProvider(val as Provider)}
          />
        </div>

        <div className="form-group">
          <label>EMAIL ADDRESS:</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
            required
          />
        </div>

        <div className="form-group">
          <label>
            {provider === 'gmail' ? 'APP PASSWORD:' : 'PASSWORD:'}
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {provider === 'gmail' && (
            <span className="form-hint">
              Use an App Password, not your regular password.
              <br />
              Generate at: myaccount.google.com/apppasswords
            </span>
          )}
        </div>

        {provider === 'custom' && (
          <>
            <div className="form-group">
              <label>IMAP HOST:</label>
              <input
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="imap.example.com"
                required
              />
            </div>
            <div className="form-group">
              <label>PORT:</label>
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
                required
              />
            </div>
          </>
        )}

        <div className="form-actions">
          <button type="submit" className="btn-primary" disabled={testing} onClick={() => playSelect()}>
            {testing ? 'TESTING...' : '[+] CONNECT'}
          </button>
          <button type="button" className="btn-secondary" onClick={() => { playSelect(); setView('menu'); }}>
            {'<'}- BACK
          </button>
        </div>
      </form>
    </div>
  );
}
