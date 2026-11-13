// Keeping the profile in step between this browser and Google Drive (#74). The newer copy wins.
// An empty profile that's newer than Drive's copy means it was cleared, so Drive's copy is deleted.
import { isEmptyProfile, sanitizeProfile, type Profile } from '../state/profile';
import type { DriveTemplates } from './driveTemplates';

export const PROFILE_FILE_FORMAT = 'latex-editor-profile';

export type TimedProfile = { profile: Profile; updatedAt: number };

export function serializeProfile({ profile, updatedAt }: TimedProfile): string {
  return `${JSON.stringify({ format: PROFILE_FILE_FORMAT, version: 1, updatedAt, profile }, null, 2)}\n`;
}

/** Read a saved profile file. Anything that isn't one gives null. */
export function parseProfileFile(text: string | null): TimedProfile | null {
  if (!text) return null;
  try {
    const file = JSON.parse(text) as { format?: unknown; updatedAt?: unknown; profile?: unknown };
    if (file?.format !== PROFILE_FILE_FORMAT) return null;
    const profile = sanitizeProfile(file.profile);
    if (!profile) return null;
    return { profile, updatedAt: typeof file.updatedAt === 'number' ? file.updatedAt : 0 };
  } catch {
    return null;
  }
}

const same = (a: Profile, b: Profile) => JSON.stringify(a) === JSON.stringify(b);

export type SyncResult = { action: 'pulled'; profile: Profile } | { action: 'pushed' | 'deleted' | 'none' };

/**
 * Bring this browser's profile and Drive's into step. `local.updatedAt` is when the profile last
 * changed here (0 if never). A pulled profile is returned for the caller to save.
 */
export async function syncProfile(local: TimedProfile, drive: Pick<DriveTemplates, 'readProfile' | 'writeProfile' | 'deleteProfile'>): Promise<SyncResult> {
  const remote = parseProfileFile(await drive.readProfile());
  if (remote && same(remote.profile, local.profile)) return { action: 'none' };
  if (remote && remote.updatedAt > local.updatedAt) return { action: 'pulled', profile: remote.profile };
  if (isEmptyProfile(local.profile)) {
    return (await drive.deleteProfile()) > 0 ? { action: 'deleted' } : { action: 'none' };
  }
  await drive.writeProfile(serializeProfile(local));
  return { action: 'pushed' };
}
