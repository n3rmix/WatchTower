const StatCard = ({ icon, label, value, color, testId }) => {
  return (
    <div className="tactical-card p-4 corner-accent" data-testid={testId}>
      <div className="flex items-center justify-between mb-2">
        <div className={`${color}`}>{icon}</div>
      </div>
      <p className="text-xs text-zinc-400 uppercase tracking-wider font-mono mb-1">{label}</p>
      <p className={`text-2xl md:text-3xl font-bold data-display ${color}`}>{value}</p>
    </div>
  );
};

export default StatCard;