// The small route. Every limit that decides what counts as a small job lives here,
// so tuning it later is one change in one place.

// A job is never small when the request touches the subjects people get called about.
const SENSITIVE = /\b(log\s?-?in|sign\s?-?in|auth\w*|password|passwort|payment|pay|card|billing|personal\s+data|privacy|secret|token|credential)\b/i;

// A job is only small when the person's own words say it is tiny. Anything else gets
// the full route: a wrong "small" is worse than a wasted page.
const SMALL_HINTS = /\b(typo|spelling|wording|rename|label|caption|comment|colour|color|one[\s-]?line|one[\s-]?liner|small\s+fix|tiny|quick\s+fix|copy\s+change|text\s+change)\b/i;

// A small job may touch at most this many files.
export const MAX_SMALL_FILES = 2;

// Touching any of these means a dependency may have been added, which is never small.
const DEPENDENCY_FILES = /(^|\/)(package\.json|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|requirements\.txt|pyproject\.toml|go\.(mod|sum)|Cargo\.(toml|lock)|pubspec\.(yaml|lock)|Gemfile(\.lock)?|composer\.(json|lock))$/;

// Which route a request gets, from the person's words alone.
export function requestLane(request) {
  const words = String(request ?? "");
  if (SENSITIVE.test(words)) return "full";
  return SMALL_HINTS.test(words) ? "quick" : "full";
}

// After the build: did the change outgrow the small route?
export function exceedsSmall(files) {
  const list = (files ?? []).map(String).filter(Boolean);
  if (list.length > MAX_SMALL_FILES) return true;
  return list.some((file) => DEPENDENCY_FILES.test(file.replace(/\\/g, "/")));
}
