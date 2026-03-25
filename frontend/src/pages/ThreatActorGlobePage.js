import Header from "../components/Header";

const ThreatActorGlobePage = () => {
  return (
    <div className="flex flex-col h-screen bg-[#09090b]">
      <Header
        dataLastFetch={null}
        sourcesUsed={[]}
        nextFetchIn={null}
        onRefresh={() => {}}
      />
      <div className="flex-1 overflow-hidden">
        <iframe
          src="/threat-actor-globe.html"
          title="Threat Actor Globe"
          className="w-full h-full border-0"
          style={{ display: "block" }}
        />
      </div>
    </div>
  );
};

export default ThreatActorGlobePage;
