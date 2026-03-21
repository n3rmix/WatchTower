import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { ArrowLeft, Save, Key, Database, Shield } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const Settings = () => {
  const navigate = useNavigate();
  const [apiKeys, setApiKeys] = useState([]);
  const [newKey, setNewKey] = useState({ service_name: '', api_key: '' });
  const [acled, setAcled] = useState({ email: '', api_key: '' });
  const [ucdpKey, setUcdpKey] = useState('');
  const [message, setMessage] = useState('');
  const [acledMessage, setAcledMessage] = useState('');
  const [ucdpMessage, setUcdpMessage] = useState('');

  useEffect(() => {
    fetchApiKeys();
  }, []);

  const fetchApiKeys = async () => {
    try {
      const response = await axios.get(`${API}/settings/api-keys`);
      setApiKeys(response.data);
    } catch (error) {
      console.error("Error fetching API keys:", error);
    }
  };

  const handleSaveKey = async (e) => {
    e.preventDefault();
    if (!newKey.service_name || !newKey.api_key) {
      setMessage('Please fill in all fields');
      return;
    }
    try {
      await axios.post(`${API}/settings/api-keys`, newKey);
      setMessage('API key saved successfully');
      setNewKey({ service_name: '', api_key: '' });
      fetchApiKeys();
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      setMessage('Error saving API key');
      console.error(error);
    }
  };

  const handleSaveAcled = async (e) => {
    e.preventDefault();
    if (!acled.email || !acled.api_key) {
      setAcledMessage('Please enter both your ACLED email and API key');
      return;
    }
    try {
      await Promise.all([
        axios.post(`${API}/settings/api-keys`, { service_name: 'ACLED_EMAIL', api_key: acled.email }),
        axios.post(`${API}/settings/api-keys`, { service_name: 'ACLED', api_key: acled.api_key }),
      ]);
      setAcledMessage('ACLED credentials saved — will be used on next hourly refresh');
      setAcled({ email: '', api_key: '' });
      fetchApiKeys();
      setTimeout(() => setAcledMessage(''), 4000);
    } catch (error) {
      setAcledMessage('Error saving ACLED credentials');
      console.error(error);
    }
  };

  const handleSaveUcdp = async (e) => {
    e.preventDefault();
    if (!ucdpKey) {
      setUcdpMessage('Please enter your UCDP access token');
      return;
    }
    try {
      await axios.post(`${API}/settings/api-keys`, { service_name: 'UCDP', api_key: ucdpKey });
      setUcdpMessage('UCDP token saved — will be used on next hourly refresh');
      setUcdpKey('');
      fetchApiKeys();
      setTimeout(() => setUcdpMessage(''), 4000);
    } catch (error) {
      setUcdpMessage('Error saving UCDP token');
      console.error(error);
    }
  };

  const ucdpConfigured = apiKeys.some(k => k.service_name === 'UCDP');
  const acledConfigured = apiKeys.some(k => k.service_name === 'ACLED') &&
                          apiKeys.some(k => k.service_name === 'ACLED_EMAIL');

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100" data-testid="settings-page">
      <div className="container mx-auto px-4 py-8 relative z-10">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <button
            onClick={() => navigate('/')}
            className="p-2 hover:bg-zinc-800 rounded-sm transition-colors"
            data-testid="back-to-dashboard-btn"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <h1 className="text-4xl font-bold uppercase tracking-tight heading-tactical" data-testid="settings-title">
            Settings
          </h1>
        </div>

        <div className="space-y-8 max-w-2xl">
          {/* ── UCDP Section ──────────────────────────────────────────────── */}
          <div className="tactical-card p-6 corner-accent" data-testid="ucdp-section">
            <div className="flex items-center gap-3 mb-4">
              <Shield className="w-6 h-6 text-red-500" />
              <h2 className="text-2xl font-semibold uppercase tracking-tight heading-tactical text-zinc-300">
                UCDP Access Token
              </h2>
              {ucdpConfigured && (
                <span className="ml-auto text-xs font-mono text-green-400 border border-green-800 bg-green-950/30 px-2 py-0.5 rounded-sm">
                  CONFIGURED
                </span>
              )}
            </div>

            <p className="text-sm text-zinc-400 mb-2">
              The Uppsala Conflict Data Program (UCDP) is the primary source for casualty figures
              in the Casualty Breakdown and Deaths by Country charts. An access token is required
              since February 2026 — request one free at{" "}
              <span className="text-blue-400 font-mono">ucdp.uu.se</span>.
            </p>
            <p className="text-xs text-zinc-600 font-mono mb-6">
              Token is sent as the <span className="text-zinc-500">x-ucdp-access-token</span> header
              on every API request. Data is refreshed hourly.
            </p>

            <form onSubmit={handleSaveUcdp} className="space-y-4" data-testid="ucdp-form">
              <div>
                <label className="block text-xs uppercase tracking-wider text-zinc-400 mb-2 font-mono">
                  UCDP Access Token
                </label>
                <Input
                  type="password"
                  value={ucdpKey}
                  onChange={(e) => setUcdpKey(e.target.value)}
                  placeholder="Enter UCDP access token"
                  className="bg-zinc-900 border-zinc-800 text-zinc-100 font-mono text-sm"
                  data-testid="ucdp-key-input"
                />
              </div>
              <Button
                type="submit"
                className="w-full bg-red-700 hover:bg-red-600 text-white font-mono uppercase tracking-wider text-xs px-4 py-2 rounded-sm"
                data-testid="save-ucdp-btn"
              >
                <Save className="w-4 h-4 mr-2" />
                Save UCDP Token
              </Button>
            </form>

            {ucdpMessage && (
              <div className="mt-4 p-3 bg-zinc-900 border border-zinc-800 rounded-sm" data-testid="ucdp-message">
                <p className="text-sm font-mono text-zinc-300">{ucdpMessage}</p>
              </div>
            )}
          </div>

          {/* ── ACLED Section ─────────────────────────────────────────────── */}
          <div className="tactical-card p-6 corner-accent" data-testid="acled-section">
            <div className="flex items-center gap-3 mb-4">
              <Database className="w-6 h-6 text-red-500" />
              <h2 className="text-2xl font-semibold uppercase tracking-tight heading-tactical text-zinc-300">
                ACLED Credentials
              </h2>
              {acledConfigured && (
                <span className="ml-auto text-xs font-mono text-green-400 border border-green-800 bg-green-950/30 px-2 py-0.5 rounded-sm">
                  CONFIGURED
                </span>
              )}
            </div>

            <p className="text-sm text-zinc-400 mb-2">
              ACLED (Armed Conflict Location & Event Data) is the primary live source for casualty
              figures. Register for a free account at{" "}
              <span className="text-blue-400 font-mono">acleddata.com</span> to get your API key.
            </p>
            <p className="text-xs text-zinc-600 font-mono mb-6">
              When configured, ACLED data takes priority over UCDP and is fetched every hour.
              Without credentials, the app falls back to UCDP (free) and OHCHR/OCHA scraping.
            </p>

            <form onSubmit={handleSaveAcled} className="space-y-4" data-testid="acled-form">
              <div>
                <label className="block text-xs uppercase tracking-wider text-zinc-400 mb-2 font-mono">
                  ACLED Account Email
                </label>
                <Input
                  type="email"
                  value={acled.email}
                  onChange={(e) => setAcled({ ...acled, email: e.target.value })}
                  placeholder="your@email.com"
                  className="bg-zinc-900 border-zinc-800 text-zinc-100 font-mono text-sm"
                  data-testid="acled-email-input"
                />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-wider text-zinc-400 mb-2 font-mono">
                  ACLED API Key
                </label>
                <Input
                  type="password"
                  value={acled.api_key}
                  onChange={(e) => setAcled({ ...acled, api_key: e.target.value })}
                  placeholder="Enter ACLED API key"
                  className="bg-zinc-900 border-zinc-800 text-zinc-100 font-mono text-sm"
                  data-testid="acled-key-input"
                />
              </div>
              <Button
                type="submit"
                className="w-full bg-red-700 hover:bg-red-600 text-white font-mono uppercase tracking-wider text-xs px-4 py-2 rounded-sm"
                data-testid="save-acled-btn"
              >
                <Save className="w-4 h-4 mr-2" />
                Save ACLED Credentials
              </Button>
            </form>

            {acledMessage && (
              <div className="mt-4 p-3 bg-zinc-900 border border-zinc-800 rounded-sm" data-testid="acled-message">
                <p className="text-sm font-mono text-zinc-300">{acledMessage}</p>
              </div>
            )}
          </div>

          {/* ── Generic API Keys Section ───────────────────────────────────── */}
          <div className="tactical-card p-6 corner-accent" data-testid="api-keys-section">
            <div className="flex items-center gap-3 mb-6">
              <Key className="w-6 h-6 text-red-500" />
              <h2 className="text-2xl font-semibold uppercase tracking-tight heading-tactical text-zinc-300">
                API Key Configuration
              </h2>
            </div>

            <p className="text-sm text-zinc-400 mb-6">
              Configure API keys for other external services.
            </p>

            <form onSubmit={handleSaveKey} className="space-y-4 mb-8" data-testid="add-api-key-form">
              <div>
                <label className="block text-xs uppercase tracking-wider text-zinc-400 mb-2 font-mono">
                  Service Name
                </label>
                <Input
                  type="text"
                  value={newKey.service_name}
                  onChange={(e) => setNewKey({ ...newKey, service_name: e.target.value })}
                  placeholder="e.g., NewsAPI, etc."
                  className="bg-zinc-900 border-zinc-800 text-zinc-100 font-mono text-sm"
                  data-testid="service-name-input"
                />
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wider text-zinc-400 mb-2 font-mono">
                  API Key
                </label>
                <Input
                  type="password"
                  value={newKey.api_key}
                  onChange={(e) => setNewKey({ ...newKey, api_key: e.target.value })}
                  placeholder="Enter API key"
                  className="bg-zinc-900 border-zinc-800 text-zinc-100 font-mono text-sm"
                  data-testid="api-key-input"
                />
              </div>

              <Button
                type="submit"
                className="w-full bg-red-700 hover:bg-red-600 text-white font-mono uppercase tracking-wider text-xs px-4 py-2 rounded-sm"
                data-testid="save-api-key-btn"
              >
                <Save className="w-4 h-4 mr-2" />
                Save API Key
              </Button>
            </form>

            {message && (
              <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-sm mb-6" data-testid="message-display">
                <p className="text-sm font-mono text-zinc-300">{message}</p>
              </div>
            )}

            {/* Configured Keys List */}
            <div data-testid="configured-keys-list">
              <h3 className="text-lg font-semibold uppercase tracking-tight mb-4 heading-tactical text-zinc-400">
                Configured Keys
              </h3>
              {apiKeys.length === 0 ? (
                <p className="text-sm text-zinc-500 font-mono">No API keys configured yet.</p>
              ) : (
                <div className="space-y-2">
                  {apiKeys.map((key, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between p-3 bg-zinc-900 border border-zinc-800 rounded-sm"
                      data-testid={`api-key-item-${index}`}
                    >
                      <div>
                        <p className="text-sm font-mono text-zinc-300">{key.service_name}</p>
                        <p className="text-xs font-mono text-zinc-500 mt-1">{key.api_key_masked}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;
