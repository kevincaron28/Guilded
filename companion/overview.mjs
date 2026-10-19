// Presentation readiness only. The engine remains authoritative for uploads and permissions.
export function companionOverview(config = {}, state = {}, browser = false) {
  const linked = Boolean(config.companionCredential);
  const wowEnabled = config.wowEnabled !== false;
  const wowFile = wowEnabled && Boolean(state.watching || config.watchFile);
  const poeFile = Boolean(config.poeEnabled && config.poeLogFile);
  const selectedFiles = Number(wowFile) + Number(poeFile);
  const paused = linked && !browser && !state.running;
  return {
    linked,
    selectedFiles,
    canSync: linked && selectedFiles > 0,
    connection: linked ? 'Account linked' : 'Not connected',
    files: selectedFiles ? `${selectedFiles} selected ${selectedFiles === 1 ? 'source' : 'sources'}` : 'Choose your game files',
    tracking: !linked ? 'Connect your account first' : paused ? 'Tracking paused' : browser ? 'Manual browser sync' : state.running ? 'Desktop tracking running' : 'Ready to configure',
    standings: config.personal ? 'Not used by this connection' : state.lastStandings ? 'Standings refreshed' : 'Not refreshed yet',
    nextAction: linked ? 'Manage connection' : 'Connect your companion'
  };
}
