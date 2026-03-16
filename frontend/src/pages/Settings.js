import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { ArrowLeft, Save, Key } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const Settings = () => {
  const navigate = useNavigate();
  const [apiKeys, setApiKeys] = useState([]);
  const [newKey, setNewKey] = useState({ service_name: '', api_key: '' });
  const [message, setMessage] = useState('');

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

        {/* API Keys Section */}
        <div className="tactical-card p-6 corner-accent max-w-2xl" data-testid="api-keys-section">
          <div className="flex items-center gap-3 mb-6">
            <Key className="w-6 h-6 text-red-500" />
            <h2 className="text-2xl font-semibold uppercase tracking-tight heading-tactical text-zinc-300">
              API Key Configuration
            </h2>
          </div>

          <p className="text-sm text-zinc-400 mb-6">
            Configure API keys for external services. These keys are encrypted and stored securely.
          </p>

          {/* Add New Key Form */}
          <form onSubmit={handleSaveKey} className="space-y-4 mb-8" data-testid="add-api-key-form">
            <div>
              <label className="block text-xs uppercase tracking-wider text-zinc-400 mb-2 font-mono">
                Service Name
              </label>
              <Input
                type="text"
                value={newKey.service_name}
                onChange={(e) => setNewKey({ ...newKey, service_name: e.target.value })}
                placeholder="e.g., NewsAPI, ACLED, etc."
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
  );
};

export default Settings;