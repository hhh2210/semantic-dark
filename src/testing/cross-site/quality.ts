export type ObservedThemeProfile =
  | 'unavailable'
  | 'light-stable'
  | 'system-dark-or-mixed'
  | 'author-dark-static'
  | 'system-light-or-ambiguous'
  | 'unknown';

export interface CrossSiteObservation {
  site_id: string;
  url?: string;
  expected_layer?: string;
  content_eligible?: boolean;
  exclude_reason?: string | null;
  extension?: {status?: number | null; navigation_error?: string | null};
  baseline?: {status?: number | null; navigation_error?: string | null};
  light_baseline?: {authored_dark_like?: boolean | null};
  dark_baseline?: {authored_dark_like?: boolean | null};
  dark_activation?: boolean | null;
  restore_equal?: boolean | null;
  native_dark_decision?: boolean | null;
  algorithm_noop?: boolean | null;
}

export interface CoveragePanel {
  denominator: number;
  active: string[];
  noop: string[];
}

export interface QualityPanels {
  loadedCount: number;
  unavailableCount: number;
  observedThemeProfile: Record<string, number>;
  /** Coverage uses measured light-stable pages, not noisy prior labels. */
  measuredLightStable: CoveragePanel;
  priorLightOnly: CoveragePanel;
  nativeDarkSafety: {
    loadedExpectedNative: number;
    falseActivations: string[];
  };
  restore: {
    equalCount: number;
    failureIds: string[];
  };
}

export function isBrowserLoaded(row: CrossSiteObservation): boolean {
  const status = row.extension?.status ?? row.baseline?.status;
  return Boolean(row.content_eligible && status != null && status >= 200 && status < 400);
}

export function observedThemeProfile(row: CrossSiteObservation): ObservedThemeProfile {
  if (!isBrowserLoaded(row)) return 'unavailable';
  const light = row.light_baseline?.authored_dark_like;
  const dark = row.dark_baseline?.authored_dark_like;
  if (light === false && dark === false) return 'light-stable';
  if (light === false && dark === true) return 'system-dark-or-mixed';
  if (light === true && dark === true) return 'author-dark-static';
  if (light === true && dark === false) return 'system-light-or-ambiguous';
  return 'unknown';
}

export function summarizeQualityPanels(
  rows: readonly CrossSiteObservation[],
): QualityPanels {
  const loaded = rows.filter(isBrowserLoaded);
  const countBy = (items: readonly CrossSiteObservation[], fn: (row: CrossSiteObservation) => string) => {
    const counts: Record<string, number> = {};
    for (const item of items) {
      const key = fn(item);
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  };
  const panel = (
    items: readonly CrossSiteObservation[],
  ): CoveragePanel => ({
    denominator: items.length,
    active: items.filter((row) => row.dark_activation === true).map((row) => row.site_id),
    noop: items.filter((row) => row.dark_activation === false).map((row) => row.site_id),
  });

  return {
    loadedCount: loaded.length,
    unavailableCount: rows.length - loaded.length,
    observedThemeProfile: countBy(loaded, observedThemeProfile),
    measuredLightStable: panel(loaded.filter((row) => observedThemeProfile(row) === 'light-stable')),
    priorLightOnly: panel(loaded.filter((row) => row.expected_layer === 'light-only')),
    nativeDarkSafety: {
      loadedExpectedNative: loaded.filter((row) => row.expected_layer === 'native-dark').length,
      falseActivations: loaded
        .filter((row) => row.expected_layer === 'native-dark' && row.dark_activation === true)
        .map((row) => row.site_id),
    },
    restore: {
      equalCount: loaded.filter((row) => row.restore_equal === true).length,
      failureIds: loaded.filter((row) => row.restore_equal === false).map((row) => row.site_id),
    },
  };
}
