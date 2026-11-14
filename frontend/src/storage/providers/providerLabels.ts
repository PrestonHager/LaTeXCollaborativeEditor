import type { AccountStatus, ProviderCapabilities, ProviderId } from './registry';

// The words for the provider registry (registry.ts), kept apart so they load with the Accounts panel
// and the Open dialog instead of with the page.

/** One line on where each provider's files go. */
export const providerDescriptions: Record<ProviderId, string> = {
  local: 'Saved in this browser on this device. Nothing is uploaded.',
  googleDrive: 'A folder in your Google Drive. The app only sees files it made or you picked.',
};

export const statusLabels: Record<AccountStatus, string> = {
  connected: 'Connected',
  expired: 'Expired',
  signedOut: 'Not connected',
  notConfigured: 'Not configured',
};

/** "Folders, images and other files, version history" for the Accounts panel. */
export function describeCapabilities(capabilities: ProviderCapabilities): string {
  const parts: string[] = [];
  if (capabilities.folders) parts.push('folders');
  if (capabilities.binaryFiles) parts.push('images and other files');
  if (capabilities.history) parts.push('version history');
  const text = parts.join(', ');
  return text ? text[0].toUpperCase() + text.slice(1) : 'Text files only';
}
