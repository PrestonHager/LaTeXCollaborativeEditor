// The choices the profile and templates offer for language and paper size (#74), and guesses
// from the browser's locale. They load with the template dialogs, not with the page.

/** The babel languages the profile offers. Each one works with pdfLaTeX, T1 and Latin Modern. */
export const PROFILE_LANGUAGES: readonly { value: string; label: string }[] = [
  { value: 'english', label: 'English' },
  { value: 'american', label: 'English (US)' },
  { value: 'british', label: 'English (UK)' },
  { value: 'canadian', label: 'English (Canada)' },
  { value: 'australian', label: 'English (Australia)' },
  { value: 'ngerman', label: 'German' },
  { value: 'french', label: 'French' },
  { value: 'spanish', label: 'Spanish' },
  { value: 'italian', label: 'Italian' },
  { value: 'portuguese', label: 'Portuguese' },
  { value: 'brazilian', label: 'Portuguese (Brazil)' },
  { value: 'dutch', label: 'Dutch' },
  { value: 'swedish', label: 'Swedish' },
  { value: 'danish', label: 'Danish' },
  { value: 'norsk', label: 'Norwegian' },
  { value: 'finnish', label: 'Finnish' },
  { value: 'polish', label: 'Polish' },
  { value: 'czech', label: 'Czech' },
];

export const PAPER_SIZES: readonly { value: string; label: string }[] = [
  { value: 'letterpaper', label: 'US Letter' },
  { value: 'a4paper', label: 'A4' },
];

/** The babel language for a browser locale like "en-GB" or "de-AT". English when there's no match. */
export function guessLanguage(locale: string | undefined): string {
  const [lang = '', region = ''] = (locale ?? '').toLowerCase().split(/[-_]/);
  if (lang === 'en') {
    const regions: Record<string, string> = { us: 'american', gb: 'british', uk: 'british', ca: 'canadian', au: 'australian' };
    return regions[region] ?? 'english';
  }
  if (lang === 'pt') return region === 'br' ? 'brazilian' : 'portuguese';
  const languages: Record<string, string> = {
    de: 'ngerman',
    fr: 'french',
    es: 'spanish',
    it: 'italian',
    nl: 'dutch',
    sv: 'swedish',
    da: 'danish',
    nb: 'norsk',
    no: 'norsk',
    nn: 'norsk',
    fi: 'finnish',
    pl: 'polish',
    cs: 'czech',
  };
  return languages[lang] ?? 'english';
}

/** US Letter in the US, Canada and a few others that use it; A4 everywhere else. */
export function guessPaper(locale: string | undefined): string {
  const region = (locale ?? '').toUpperCase().split(/[-_]/)[1] ?? '';
  return ['US', 'CA', 'MX', 'PH', 'CL', 'CO', 'VE', 'PR', 'GT', 'CR'].includes(region) ? 'letterpaper' : 'a4paper';
}
