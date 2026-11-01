// Presentation readiness only. The engine remains authoritative for uploads and permissions.
export function companionOverview(config = {}, state = {}, browser = false) {
  const linked = Boolean(config.companionCredential);
  const wowEnabled = config.wowEnabled !== false;
  const wowFile = wowEnabled && Boolean(state.watching || config.watchFile);
  const poeFile = Boolean(config.poeEnabled && config.poeLogFile);
  const selectedFiles = Number(wowFile) + Number(poeFile);
  const paused = linked && !browser && !state.running;
  const phases = { "waiting-save": "Waiting for a game save", uploading: "Uploading saved data", synced: "Saved data synced", "officer-review": "Waiting for officer review", "apply-error": "Uploaded; server action needed", retry: "Connection interrupted; retrying", "needs-attention": "Connection needs attention" };
  return {
    linked,
    selectedFiles,
    canSync: linked && selectedFiles > 0,
    connection: linked ? 'Account linked' : 'Not connected',
    files: selectedFiles ? `${selectedFiles} selected ${selectedFiles === 1 ? 'source' : 'sources'}` : 'Choose your game files',
    tracking: !linked ? 'Connect your account first' : paused ? 'Tracking paused' : browser ? 'Manual browser sync' : state.running ? phases[state.syncPhase] || 'Desktop tracking running' : 'Ready to configure',
    standings: config.personal ? 'Not used by this connection' : state.lastStandings ? 'Standings refreshed' : 'Not refreshed yet',
    nextAction: !linked ? 'Connect your account' : !selectedFiles ? 'Choose your saved data' : paused ? 'Resume tracking' : browser ? 'Open sync instructions' : state.lastUpload ? 'View sync activity' : 'Save in WoW, then check sync',
    nextPage: !linked || !selectedFiles || paused ? 'settings' : browser ? 'wow' : 'activity'
  };
}
