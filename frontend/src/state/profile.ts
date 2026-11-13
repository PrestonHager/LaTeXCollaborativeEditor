/**
 * The person's own details for templates (#74): name, affiliation, email and the like. Templates
 * use them to fill in placeholders such as {{name}} when a project is created.
 *
 * The profile is personal data. It's kept in the settings store (this browser only) and, when
 * Google Drive is connected, in the Drive Templates folder. It is never sent to peers: only text
 * that a template already put into a project travels with that project.
 */
export type Profile = {
  name: string;
  affiliation: string;
  email: string;
  orcid: string;
  /** Postal address, one line per line. Letters use it. */
  address: string;
  /** A babel language name, like "english" or "ngerman". Empty means guess from the browser. */
  language: string;
  /** "letterpaper" or "a4paper". Empty means guess from the browser. */
  paper: string;
};

export type ProfileField = keyof Profile;

export const emptyProfile = (): Profile => ({ name: '', affiliation: '', email: '', orcid: '', address: '', language: '', paper: '' });

// Longest value kept for each field, so a pasted essay can't fill up storage.
const LIMITS: Record<ProfileField, number> = { name: 200, affiliation: 300, email: 200, orcid: 40, address: 600, language: 20, paper: 20 };

/** Keep only a well-formed profile. Unknown fields go, strings are trimmed and capped. */
export function sanitizeProfile(value: unknown): Profile | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const profile = emptyProfile();
  for (const key of Object.keys(profile) as ProfileField[]) {
    const field = raw[key];
    if (typeof field === 'string') profile[key] = field.replace(/\r\n?/g, '\n').trim().slice(0, LIMITS[key]);
  }
  // The lists to pick from load with the templates (templates/profileOptions.ts); the check here is just their shape.
  if (!/^[a-z]{2,20}$/.test(profile.language)) profile.language = '';
  if (profile.paper !== 'letterpaper' && profile.paper !== 'a4paper') profile.paper = '';
  return profile;
}

/** True when nothing is filled in. */
export const isEmptyProfile = (profile: Profile): boolean => Object.values(profile).every((value) => !value);
