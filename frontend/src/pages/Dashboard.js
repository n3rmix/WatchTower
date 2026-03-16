import { useEffect, useState } from "react";
import axios from "axios";
import { Globe, Skull, Target, AlertTriangle, Users, Baby, Activity } from "lucide-react";
import Marquee from "react-fast-marquee";
import { BarChart, Bar, PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend, XAxis, YAxis } from "recharts";
import Header from "../components/Header";
import NewsTicker from "../components/NewsTicker";
import StatCard from "../components/StatCard";
import ConflictTable from "../components/ConflictTable";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const Dashboard = () => {
  const [conflicts, setConflicts] = useState([]);
  const [news, setNews] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(new Date());

  const fetchData = async () => {
    try {
      const [conflictsRes, newsRes, statsRes] = await Promise.all([
        axios.get(`${API}/conflicts`),
        axios.get(`${API}/news`),
        axios.get(`${API}/stats`)
      ]);
      
      setConflicts(conflictsRes.data);
      setNews(newsRes.data);
      setStats(statsRes.data);
      setLastUpdate(new Date());
      setLoading(false);
    } catch (error) {
      console.error("Error fetching data:", error);
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    
    // Auto-refresh every 5 minutes
    const interval = setInterval(() => {
      fetchData();
    }, 5 * 60 * 1000);
    
    return () => clearInterval(interval);
  }, []);

  const casualtyData = stats ? [
    { name: 'Civilian', value: stats.civilian_deaths, color: '#dc2626' },
    { name: 'Military', value: stats.military_deaths, color: '#64748b' },
  ] : [];

  const countryData = conflicts.map(c => ({
    country: c.country,
    deaths: c.total_deaths
  })).sort((a, b) => b.deaths - a.deaths).slice(0, 9);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#09090b]">
        <div className="text-center">
          <Activity className="w-12 h-12 text-red-700 animate-pulse mx-auto mb-4" />
          <p className="text-zinc-400 font-mono text-sm uppercase tracking-wider">Loading data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100" data-testid="dashboard-container">
      <Header lastUpdate={lastUpdate} onRefresh={fetchData} />
      
      <main className="container mx-auto px-4 py-6 relative z-10">
        {/* Global Statistics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4 mb-6" data-testid="stats-grid">
          <StatCard
            icon={<Skull className="w-5 h-5" />}
            label="Total Deaths"
            value={stats?.total_deaths?.toLocaleString() || '0'}
            color="text-red-500"
            testId="stat-total-deaths"
          />
          <StatCard
            icon={<Users className="w-5 h-5" />}
            label="Civilian"
            value={stats?.civilian_deaths?.toLocaleString() || '0'}
            color="text-red-600"
            testId="stat-civilian-deaths"
          />
          <StatCard
            icon={<Target className="w-5 h-5" />}
            label="Military"
            value={stats?.military_deaths?.toLocaleString() || '0'}
            color="text-zinc-400"
            testId="stat-military-deaths"
          />
          <StatCard
            icon={<Baby className="w-5 h-5" />}
            label="Children"
            value={stats?.children_deaths?.toLocaleString() || '0'}
            color="text-red-700"
            testId="stat-children-deaths"
          />
        </div>

        {/* Active Conflicts Count */}
        <div className="tactical-card p-4 mb-6 corner-accent" data-testid="active-conflicts-banner">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-6 h-6 text-red-500" />
              <div>
                <p className="text-xs text-zinc-400 uppercase tracking-wider font-mono">Active Conflicts</p>
                <p className="text-2xl font-bold font-mono text-red-500" data-testid="active-conflicts-count">{stats?.active_conflicts || 0}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-red-500 rounded-full blink-animation"></div>
              <span className="text-xs text-red-500 font-mono uppercase tracking-widest">LIVE</span>
            </div>
          </div>
        </div>

        {/* Charts Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {/* Civilian vs Military Chart */}
          <div className="tactical-card p-6 corner-accent" data-testid="casualty-breakdown-chart">
            <h3 className="text-xl font-semibold uppercase tracking-tight mb-4 heading-tactical text-zinc-300">
              Casualty Breakdown
            </h3>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={casualtyData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  fill="#8884d8"
                  paddingAngle={5}
                  dataKey="value"
                >
                  {casualtyData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#121214',
                    border: '1px solid #27272a',
                    borderRadius: '2px',
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: '12px'
                  }}
                  formatter={(value) => value.toLocaleString()}
                />
                <Legend
                  wrapperStyle={{
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: '11px'
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Deaths by Country Chart */}
          <div className="tactical-card p-6 corner-accent" data-testid="deaths-by-country-chart">
            <h3 className="text-xl font-semibold uppercase tracking-tight mb-4 heading-tactical text-zinc-300">
              Deaths by Country
            </h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={countryData}>
                <XAxis
                  dataKey="country"
                  tick={{ fill: '#94a3b8', fontSize: 10, fontFamily: 'JetBrains Mono' }}
                  angle={-45}
                  textAnchor="end"
                  height={80}
                />
                <YAxis
                  tick={{ fill: '#94a3b8', fontSize: 10, fontFamily: 'JetBrains Mono' }}
                  tickFormatter={(value) => value.toLocaleString()}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#121214',
                    border: '1px solid #27272a',
                    borderRadius: '2px',
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: '12px'
                  }}
                  formatter={(value) => value.toLocaleString()}
                />
                <Bar dataKey="deaths" fill="#dc2626" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Conflicts Table */}
        <ConflictTable conflicts={conflicts} />
      </main>

      {/* News Ticker */}
      <NewsTicker news={news} />
    </div>
  );
};

export default Dashboard;