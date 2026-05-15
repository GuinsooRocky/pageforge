// Footprint extraction core - extracts 6 categories of structural facts from a TSX/TS file.
// Used by both footprint-extractor and develop-diff-validator scripts.
//
// Categories:
//   1. imports         - import statements (named / default / from path / is component lib)
//   2. tracking_calls  - tracking function invocations (TrackButtonClick / tl / tc / etc)
//   3. i18n_keys       - i18n key usage via t() / tl() / tc()
//   4. business_filters - .filter / .includes / .some / .every / .find call sites
//   5. responsive      - JS detect hooks + CSS breakpoint usage + strategy classification
//   6. dark_mode       - dark: tailwind classes (or theme-context identifiers)
//   + bonus: rollout   - useGradualRollout / ROLLOUT_TOPIC hits
//
// Configuration is read from [CODE_BASELINE] (passed in or auto-discovered),
// with sensible defaults if baseline is missing or fields are absent.

import fs from 'node:fs';

// 默认值仅含跨项目通用语义，不含项目特定函数名。
// baseline 中的项目特定值会覆盖默认。
// 项目方未在 baseline 显式提供时：
//   - 通用默认能猜中的（如 i18n 标准函数 't' / Tailwind dark: 类）→ 命中
//   - 项目自创函数名（如 TrackButtonClick / tl / tc）→ 不命中，§4.0 该字段为空
//     这是**正确行为**——LLM 看到"无埋点足迹"会主动询问而非静默漏抓
const DEFAULT_CONFIG = {
  trackingFunctions: [], // 项目自创埋点函数族，必须由 baseline M5 显式提供；缺则不抓
  i18nFunctions: ['t'], // i18n 标准函数；项目用其他名由 baseline M7 覆盖
  componentLibPrefixes: ['@/components/'], // 通用 monorepo 别名；非 alias 项目由 baseline M4 覆盖
  rolloutPattern: 'use\\w*FeatureFlag\\w*|use\\w*ABTest\\w*|use\\w*Rollout\\w*', // 通用语义模式；项目自创 enum 名由 baseline M8 覆盖
  darkModePattern: 'tailwind-dark-class', // 'tailwind-dark-class' | 'theme-context'；由 baseline M3 覆盖
};

// Parse [CODE_BASELINE] (markdown) for project-specific config.
// Convention: fields appear as `name: value` or `name: ['a','b']` in any line.
// Returns merged config (defaults overridden by baseline-found values).
export function loadBaselineConfig(baselinePath) {
  if (!baselinePath || !fs.existsSync(baselinePath)) return DEFAULT_CONFIG;
  const content = fs.readFileSync(baselinePath, 'utf8');
  return {
    trackingFunctions: parseListField(content, /tracking[_\s]?function[_\s]?names?\s*:?\s*(\[[^\]]+\])/i)
      || DEFAULT_CONFIG.trackingFunctions,
    i18nFunctions: parseListField(content, /i18n[_\s]?function[_\s]?names?\s*:?\s*(\[[^\]]+\])/i)
      || DEFAULT_CONFIG.i18nFunctions,
    componentLibPrefixes: parseListField(content, /component[_\s]?lib[_\s]?prefixes?\s*:?\s*(\[[^\]]+\])/i)
      || DEFAULT_CONFIG.componentLibPrefixes,
    rolloutPattern: parseStringField(content, /rollout[_\s]?hook[_\s]?pattern\s*:?\s*['"]([^'"]+)['"]/i)
      || DEFAULT_CONFIG.rolloutPattern,
    darkModePattern: parseStringField(content, /dark[_\s]?mode[_\s]?pattern\s*:?\s*['"]([^'"]+)['"]/i)
      || DEFAULT_CONFIG.darkModePattern,
  };
}

function parseListField(content, regex) {
  const m = content.match(regex);
  if (!m) return null;
  try {
    return JSON.parse(m[1].replace(/'/g, '"'));
  } catch {
    return null;
  }
}

function parseStringField(content, regex) {
  const m = content.match(regex);
  return m ? m[1] : null;
}

// Extract footprint from a single TSX/TS source file.
// Returns object with 6+1 categories (each is an array of {line, ...} entries).
export function extractFootprint(filePath, config = DEFAULT_CONFIG) {
  if (!fs.existsSync(filePath)) {
    return { path: filePath, error: 'file_not_found' };
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  return {
    path: filePath,
    imports: extractImports(lines, config),
    tracking_calls: extractTrackingCalls(lines, config),
    i18n_keys: extractI18nKeys(lines, config),
    business_filters: extractBusinessFilters(lines),
    responsive: extractResponsive(lines),
    dark_mode: extractDarkMode(lines, config),
    rollout: extractRollout(lines, config),
  };
}

function extractImports(lines, config) {
  const result = [];
  // Match start of import statement (single-line forms; multi-line we approximate via full content fallback below)
  const singleLineRe =
    /^\s*import\s+(?:type\s+)?(?:(?:\*\s+as\s+\w+)|(?:\{[^}]*\})|(?:\w+\s*,\s*\{[^}]*\})|\w+)\s+from\s+['"]([^'"]+)['"]/;
  // Side-effect import: import 'foo'
  const sideEffectRe = /^\s*import\s+['"]([^'"]+)['"]/;

  lines.forEach((line, idx) => {
    let m = line.match(singleLineRe);
    if (m) {
      const from = m[1];
      const namedMatch = line.match(/\{([^}]+)\}/);
      const named = namedMatch
        ? namedMatch[1]
            .split(',')
            .map((s) => s.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, '').trim())
            .filter(Boolean)
        : [];
      const defaultMatch = line.match(/^\s*import\s+(?!type\s)(?!\{)(?!\*\s)(\w+)\s*[,\s]/);
      const defaultName = defaultMatch ? defaultMatch[1] : null;
      result.push({
        line: idx + 1,
        from,
        named,
        default: defaultName,
        is_component_lib: config.componentLibPrefixes.some((p) => from.startsWith(p)),
        is_type_only: /^\s*import\s+type\s/.test(line),
      });
      return;
    }
    m = line.match(sideEffectRe);
    if (m) {
      result.push({
        line: idx + 1,
        from: m[1],
        named: [],
        default: null,
        is_component_lib: config.componentLibPrefixes.some((p) => m[1].startsWith(p)),
        is_side_effect: true,
      });
    }
  });
  return result;
}

function extractTrackingCalls(lines, config) {
  const result = [];
  const fnPattern = config.trackingFunctions.map(escapeRegex).join('|');
  // Match function call with optional first string arg
  const re = new RegExp(`\\b(${fnPattern})\\s*\\(\\s*['"]?([^'"\\),]*?)['"]?(?:[\\),]|$)`, 'g');
  lines.forEach((line, idx) => {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(line)) !== null) {
      result.push({
        line: idx + 1,
        call: m[1],
        first_arg: m[2] ? m[2].trim() : null,
      });
    }
  });
  return result;
}

function extractI18nKeys(lines, config) {
  const result = [];
  const fnPattern = config.i18nFunctions.map(escapeRegex).join('|');
  const re = new RegExp(`\\b(${fnPattern})\\s*\\(\\s*['"]([^'"]+)['"]`, 'g');
  lines.forEach((line, idx) => {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(line)) !== null) {
      result.push({
        line: idx + 1,
        call: m[1],
        key: m[2],
      });
    }
  });
  // Dedup by (call, key) preserving first occurrence
  const seen = new Set();
  return result.filter((r) => {
    const k = `${r.call}|${r.key}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function extractBusinessFilters(lines) {
  const result = [];
  const patterns = [
    { name: 'array_filter', re: /\.filter\s*\(/g },
    { name: 'array_includes', re: /\.includes\s*\(/g },
    { name: 'array_some', re: /\.some\s*\(/g },
    { name: 'array_every', re: /\.every\s*\(/g },
    { name: 'array_find', re: /\.find\s*\(/g },
    { name: 'array_findIndex', re: /\.findIndex\s*\(/g },
    { name: 'lodash_intersection', re: /\bintersection\s*\(/g },
  ];
  lines.forEach((line, idx) => {
    patterns.forEach((p) => {
      p.re.lastIndex = 0;
      let m;
      while ((m = p.re.exec(line)) !== null) {
        const start = Math.max(0, m.index - 20);
        result.push({
          line: idx + 1,
          pattern: p.name,
          snippet: line.slice(start, start + 100).trim(),
        });
      }
    });
  });
  return result;
}

function extractResponsive(lines) {
  const hookHits = [];
  const cssHits = [];
  const hookRe = /\b(use(?:ScreenType\w*|MediaQuery|IsMobile|Breakpoint|WindowSize|Viewport\w*))\s*\(/g;
  const cssRe = /\b(sm|md|lg|xl|2xl):[\w[\]/(),.#-]+/g;

  lines.forEach((line, idx) => {
    let m;
    hookRe.lastIndex = 0;
    while ((m = hookRe.exec(line)) !== null) {
      hookHits.push({ line: idx + 1, hook: m[1] });
    }
    cssRe.lastIndex = 0;
    while ((m = cssRe.exec(line)) !== null) {
      cssHits.push({ line: idx + 1, breakpoint: m[1], class: m[0] });
    }
  });

  return {
    js_hooks: hookHits,
    css_breakpoint_count: cssHits.length,
    css_breakpoint_distinct: [...new Set(cssHits.map((c) => c.breakpoint))].sort(),
    strategy:
      hookHits.length > 0 && cssHits.length > 0
        ? 'mixed'
        : hookHits.length > 0
        ? 'js-detect'
        : cssHits.length > 0
        ? 'css-breakpoint'
        : 'none',
  };
}

function extractDarkMode(lines, config) {
  if (config.darkModePattern === 'tailwind-dark-class') {
    const result = [];
    const re = /\bdark:[\w[\]/(),.#-]+/g;
    lines.forEach((line, idx) => {
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(line)) !== null) {
        result.push({ line: idx + 1, class: m[0] });
      }
    });
    return result;
  }
  // Fallback: theme-context / css-var pattern
  const result = [];
  const re = /\b(useTheme|ThemeContext|themeMode|--theme-)\b/g;
  lines.forEach((line, idx) => {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(line)) !== null) {
      result.push({ line: idx + 1, identifier: m[1] });
    }
  });
  return result;
}

function extractRollout(lines, config) {
  const result = [];
  const re = new RegExp(config.rolloutPattern, 'g');
  lines.forEach((line, idx) => {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(line)) !== null) {
      result.push({ line: idx + 1, match: m[0] });
    }
  });
  return result;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
