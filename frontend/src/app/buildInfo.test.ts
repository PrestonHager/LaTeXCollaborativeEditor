import {
  BUILD_INFO,
  VERSION_JSON_PATH,
  commitUrl,
  compareVersions,
  formatBuildDate,
  formatVersion,
  isDifferentBuild,
  parseVersionInfo,
  readBuildInfo,
  releaseUrl,
} from './buildInfo';
import { renderFooterVersion, renderVersionDetails } from '../ui/aboutDialog';
import { bugReportUrl } from '../ui/issueLinks';

const REPO = 'https://github.com/PrestonHager/LaTeXCollaborativeEditor';
const info = { version: '0.1.0', commit: 'abc1234', builtAt: '2026-11-13T10:20:30.000Z' };

describe('readBuildInfo', () => {
  it('reads the values vite.config.ts defines', () => {
    expect(readBuildInfo({ VITE_APP_VERSION: '0.1.0', VITE_APP_COMMIT: 'abc1234', VITE_APP_BUILT_AT: info.builtAt })).toEqual(info);
  });

  it('falls back to dev for anything missing or empty', () => {
    expect(readBuildInfo({})).toEqual({ version: 'dev', commit: 'dev', builtAt: '' });
    expect(readBuildInfo({ VITE_APP_VERSION: '', VITE_APP_COMMIT: 7 })).toEqual({ version: 'dev', commit: 'dev', builtAt: '' });
  });

  it('is dev in tests, which run without the Vite define', () => {
    expect(BUILD_INFO.version).toBe('dev');
    expect(VERSION_JSON_PATH).toBe('version.json');
  });
});

describe('formatting and links', () => {
  it('writes the version with SemVer build metadata', () => {
    expect(formatVersion(info)).toBe('0.1.0+abc1234');
    expect(formatVersion({ ...info, commit: 'dev' })).toBe('0.1.0');
  });

  it('links commits and releases on GitHub', () => {
    expect(commitUrl('abc1234')).toBe(`${REPO}/commit/abc1234`);
    expect(commitUrl('dev')).toBeNull();
    expect(commitUrl('not a sha')).toBeNull();
    expect(releaseUrl('0.1.0')).toBe(`${REPO}/releases/tag/v0.1.0`);
  });

  it('shows the build date as YYYY-MM-DD', () => {
    expect(formatBuildDate(info.builtAt)).toBe('2026-11-13');
    expect(formatBuildDate('')).toBe('');
    expect(formatBuildDate('yesterday')).toBe('');
  });

  it('puts the full version in the bug form', () => {
    const url = new URL(bugReportUrl({ appVersion: formatVersion(info), userAgent: '', hostname: 'localhost' }));
    expect(url.searchParams.get('extra')).toBe('App version: 0.1.0+abc1234');
  });
});

describe('parseVersionInfo', () => {
  it('accepts a good version.json and keeps only its three fields', () => {
    expect(parseVersionInfo({ ...info, extra: 'x' })).toEqual(info);
    expect(parseVersionInfo({ ...info, commit: 'dev' })).toEqual({ ...info, commit: 'dev' });
    expect(parseVersionInfo({ ...info, version: '1.0.0-rc.1' })?.version).toBe('1.0.0-rc.1');
  });

  it('rejects anything malformed', () => {
    for (const bad of [
      null,
      'x',
      [info],
      { ...info, version: '1.0' },
      { ...info, version: 'v1.0.0' },
      { ...info, version: 1 },
      { ...info, commit: 'ABC' },
      { ...info, commit: undefined },
      { ...info, builtAt: 'soon' },
      { ...info, builtAt: 0 },
    ]) {
      expect(parseVersionInfo(bad)).toBeNull();
    }
  });
});

describe('compareVersions', () => {
  it('orders by major, minor and patch', () => {
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0);
    expect(compareVersions('0.1.0', '0.2.0')).toBe(-1);
    expect(compareVersions('1.0.0', '0.9.9')).toBe(1);
    expect(compareVersions('0.1.10', '0.1.9')).toBe(1);
  });

  it('ignores build metadata', () => {
    expect(compareVersions('0.1.0+abc1234', '0.1.0+def5678')).toBe(0);
  });

  it('puts pre-releases before the release, in SemVer order', () => {
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBe(-1);
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBe(1);
    expect(compareVersions('1.0.0-rc.1', '1.0.0-rc.2')).toBe(-1);
    expect(compareVersions('1.0.0-rc.10', '1.0.0-rc.2')).toBe(1);
    expect(compareVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1);
    expect(compareVersions('1.0.0-alpha.1', '1.0.0-alpha')).toBe(1);
    expect(compareVersions('1.0.0-1', '1.0.0-alpha')).toBe(-1);
    expect(compareVersions('1.0.0-alpha', '1.0.0-1')).toBe(1);
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBe(-1);
    expect(compareVersions('1.0.0-beta', '1.0.0-alpha')).toBe(1);
  });

  it('returns null for something that is not SemVer', () => {
    expect(compareVersions('dev', '0.1.0')).toBeNull();
    expect(compareVersions('0.1.0', '1')).toBeNull();
  });
});

describe('isDifferentBuild', () => {
  it('compares the version and, when both have one, the commit', () => {
    expect(isDifferentBuild(info, { ...info })).toBe(false);
    expect(isDifferentBuild(info, { ...info, builtAt: '2027-01-01T00:00:00Z' })).toBe(false);
    expect(isDifferentBuild(info, { ...info, version: '0.2.0' })).toBe(true);
    expect(isDifferentBuild(info, { ...info, commit: 'def5678' })).toBe(true);
    expect(isDifferentBuild(info, { ...info, commit: 'dev' })).toBe(false);
  });
});

describe('version labels', () => {
  it('fills the About dialog with the version, a commit link and the date', () => {
    const el = document.createElement('span');
    renderVersionDetails(el, info);
    expect(el.textContent).toBe('0.1.0 (commit abc1234, built 2026-11-13)');
    const link = el.querySelector('a')!;
    expect(link.href).toBe(`${REPO}/commit/abc1234`);
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noreferrer');
  });

  it('leaves out what a dev build does not have', () => {
    const el = document.createElement('span');
    renderVersionDetails(el, { version: 'dev', commit: 'dev', builtAt: '' });
    expect(el.textContent).toBe('dev');
    renderVersionDetails(el, { ...info, commit: 'dev' });
    expect(el.textContent).toBe('0.1.0 (built 2026-11-13)');
    expect(el.querySelector('a')).toBeNull();
    renderVersionDetails(el, { ...info, builtAt: '' });
    expect(el.textContent).toBe('0.1.0 (commit abc1234)');
  });

  it('fills the footer label', () => {
    const link = document.createElement('a');
    renderFooterVersion(link, info);
    expect(link.textContent).toBe('v0.1.0');
    expect(link.href).toBe(`${REPO}/commit/abc1234`);
    expect(link.title).toBe('Version 0.1.0, commit abc1234, built 2026-11-13');
    expect(link.getAttribute('aria-label')).toBe(link.title);

    renderFooterVersion(link, { version: 'dev', commit: 'dev', builtAt: '' });
    expect(link.textContent).toBe('dev build');
    expect(link.hasAttribute('href')).toBe(false);
    expect(link.title).toBe('Version dev');
  });
});
