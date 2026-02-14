const {
  parseConventionalCommit,
  parseChangelogComment,
  computeEntryHash,
  buildMarkedEntry,
  detectEntryState,
  parseCommentCommands,
  shouldSkipChangelog,
  resolveEntryAction,
  updateChangelog,
  ENTRY_STATE,
  BEHAVIOR_MODES,
  HASH_MARKER,
  COMMENT_COMMANDS,
  COMMIT_TYPE_MAPPING
} = require('./index');

const fs = require('fs');
const path = require('path');

// ─── parseConventionalCommit ────────────────────────────────────────────────
describe('parseConventionalCommit', () => {
  const mockPr = { html_url: 'https://github.com/owner/repo/pull/1' };

  test('parses feat(scope): description', () => {
    const result = parseConventionalCommit('feat(auth): add JWT tokens', mockPr, 1);
    expect(result).toBeTruthy();
    expect(result.type).toBe('feat');
    expect(result.scope).toBe('auth');
    expect(result.description).toBe('add JWT tokens');
    expect(result.section).toBe('Features');
  });

  test('parses fix without scope', () => {
    const result = parseConventionalCommit('fix: resolve login bug', mockPr, 2);
    expect(result.type).toBe('fix');
    expect(result.scope).toBeNull();
    expect(result.section).toBe('Bug Fixes');
  });

  test('returns null for non-conventional title', () => {
    expect(parseConventionalCommit('just a title', mockPr, 3)).toBeNull();
  });

  test('handles breaking change marker (!)', () => {
    const result = parseConventionalCommit('feat!: breaking change', mockPr, 4);
    expect(result).toBeTruthy();
    expect(result.type).toBe('feat');
  });

  test('maps all known commit types', () => {
    for (const [type, section] of Object.entries(COMMIT_TYPE_MAPPING)) {
      const result = parseConventionalCommit(`${type}: test`, mockPr, 99);
      if (result) {
        expect(result.section).toBe(section);
      }
    }
  });
});

// ─── parseChangelogComment ──────────────────────────────────────────────────
describe('parseChangelogComment', () => {
  const mockPr = { html_url: 'https://github.com/owner/repo/pull/5' };
  const trigger = '/changelog:';

  test('parses custom changelog entry', () => {
    const result = parseChangelogComment('/changelog: Added new feature', trigger, mockPr, 5);
    expect(result).toBeTruthy();
    expect(result.description).toBe('Added new feature');
  });

  test('parses conventional format in changelog comment', () => {
    const result = parseChangelogComment('/changelog: feat(api): add endpoint', trigger, mockPr, 5);
    expect(result).toBeTruthy();
    expect(result.type).toBe('feat');
    expect(result.scope).toBe('api');
  });

  test('returns null when trigger not found', () => {
    expect(parseChangelogComment('regular comment', trigger, mockPr, 5)).toBeNull();
  });

  test('returns null for empty description after trigger', () => {
    expect(parseChangelogComment('/changelog:', trigger, mockPr, 5)).toBeNull();
  });
});

// ─── computeEntryHash ───────────────────────────────────────────────────────
describe('computeEntryHash', () => {
  test('returns 8-char hex string', () => {
    const hash = computeEntryHash('some entry text');
    expect(hash).toMatch(/^[a-f0-9]{8}$/);
  });

  test('same input produces same hash', () => {
    const a = computeEntryHash('test entry');
    const b = computeEntryHash('test entry');
    expect(a).toBe(b);
  });

  test('different inputs produce different hashes', () => {
    const a = computeEntryHash('entry one');
    const b = computeEntryHash('entry two');
    expect(a).not.toBe(b);
  });

  test('strips existing marker before hashing', () => {
    const plain = computeEntryHash('some text');
    const withMarker = computeEntryHash('some text <!-- ac:abcd1234:99 -->');
    expect(plain).toBe(withMarker);
  });

  test('normalizes CRLF before hashing', () => {
    const lf = computeEntryHash('line one\nline two');
    const crlf = computeEntryHash('line one\r\nline two');
    expect(lf).toBe(crlf);
  });
});

// ─── buildMarkedEntry ───────────────────────────────────────────────────────
describe('buildMarkedEntry', () => {
  test('appends marker with correct format', () => {
    const result = buildMarkedEntry('some entry text', 123);
    expect(result).toMatch(/^some entry text <!-- ac:[a-f0-9]{8}:123 -->$/);
  });

  test('marker contains correct PR number', () => {
    const result = buildMarkedEntry('text', 456);
    const match = result.match(HASH_MARKER.PATTERN);
    expect(match).toBeTruthy();
    expect(match[2]).toBe('456');
  });

  test('hash in marker matches computeEntryHash', () => {
    const text = '**auth**: add JWT tokens ([#1](url))';
    const result = buildMarkedEntry(text, 1);
    const match = result.match(HASH_MARKER.PATTERN);
    const expectedHash = computeEntryHash(text);
    expect(match[1]).toBe(expectedHash);
  });

  test('strips existing marker before rebuilding', () => {
    const alreadyMarked = 'text <!-- ac:a1b2c3d4:99 -->';
    const result = buildMarkedEntry(alreadyMarked, 99);
    // Should only have one marker
    const markers = result.match(/<!-- ac:/g);
    expect(markers).toHaveLength(1);
  });
});

// ─── detectEntryState ───────────────────────────────────────────────────────
describe('detectEntryState', () => {
  test('returns NONE when no entry exists', () => {
    const changelog = `# Changelog\n\n## [Unreleased]\n\n### Features\n- something else ([#999](url))\n`;
    const result = detectEntryState(changelog, 123);
    expect(result.state).toBe(ENTRY_STATE.NONE);
    expect(result.line).toBeNull();
  });

  test('returns NONE when changelog is empty', () => {
    const result = detectEntryState('', 1);
    expect(result.state).toBe(ENTRY_STATE.NONE);
  });

  test('returns NONE when no Unreleased section', () => {
    const result = detectEntryState('# Changelog\n\n## [1.0.0]\n', 1);
    expect(result.state).toBe(ENTRY_STATE.NONE);
  });

  test('returns AUTO_UNTOUCHED when marker hash matches', () => {
    const entryText = '**auth**: add JWT tokens ([#123](url))';
    const hash = computeEntryHash(entryText);
    const changelog = `# Changelog\n\n## [Unreleased]\n\n### Features\n- ${entryText} <!-- ac:${hash}:123 -->\n`;
    const result = detectEntryState(changelog, 123);
    expect(result.state).toBe(ENTRY_STATE.AUTO_UNTOUCHED);
    expect(result.storedHash).toBe(hash);
  });

  test('returns AUTO_EDITED when marker hash does not match', () => {
    const changelog = `# Changelog\n\n## [Unreleased]\n\n### Features\n- user edited text ([#42](url)) <!-- ac:00000000:42 -->\n`;
    const result = detectEntryState(changelog, 42);
    expect(result.state).toBe(ENTRY_STATE.AUTO_EDITED);
    expect(result.storedHash).toBe('00000000');
  });

  test('returns MANUAL when entry exists without marker', () => {
    const changelog = `# Changelog\n\n## [Unreleased]\n\n### Changes\n- manual entry ([#10](url))\n`;
    const result = detectEntryState(changelog, 10);
    expect(result.state).toBe(ENTRY_STATE.MANUAL);
  });

  test('ignores entries in released sections', () => {
    const changelog = `# Changelog\n\n## [Unreleased]\n\n## [1.0.0]\n\n### Features\n- old entry ([#5](url))\n`;
    const result = detectEntryState(changelog, 5);
    expect(result.state).toBe(ENTRY_STATE.NONE);
  });

  test('detects entry by marker PR number even without PR link', () => {
    const hash = computeEntryHash('custom text');
    const changelog = `# Changelog\n\n## [Unreleased]\n\n### Features\n- custom text <!-- ac:${hash}:77 -->\n`;
    const result = detectEntryState(changelog, 77);
    expect(result.state).toBe(ENTRY_STATE.AUTO_UNTOUCHED);
  });

  test('handles multiple PRs in Unreleased — returns correct one', () => {
    const entry1 = '**a**: text ([#1](url))';
    const hash1 = computeEntryHash(entry1);
    const entry2 = '**b**: text ([#2](url))';
    const hash2 = computeEntryHash(entry2);
    const changelog = [
      '# Changelog', '', '## [Unreleased]', '', '### Features',
      `- ${entry1} <!-- ac:${hash1}:1 -->`,
      `- ${entry2} <!-- ac:${hash2}:2 -->`,
      ''
    ].join('\n');

    const r1 = detectEntryState(changelog, 1);
    expect(r1.state).toBe(ENTRY_STATE.AUTO_UNTOUCHED);
    const r2 = detectEntryState(changelog, 2);
    expect(r2.state).toBe(ENTRY_STATE.AUTO_UNTOUCHED);
  });
});

// ─── shouldSkipChangelog ────────────────────────────────────────────────────
describe('shouldSkipChangelog', () => {
  describe('auto mode', () => {
    test('returns false when no skip indicators', () => {
      const pr = { body: 'normal PR body', labels: [] };
      expect(shouldSkipChangelog(pr, BEHAVIOR_MODES.AUTO, [])).toBe(false);
    });

    test('returns true when skip checkbox is checked', () => {
      const pr = { body: '- [x] skip changelog', labels: [] };
      expect(shouldSkipChangelog(pr, BEHAVIOR_MODES.AUTO, [])).toBe(true);
    });

    test('returns true for /changelog: skip in body', () => {
      const pr = { body: '/changelog: skip', labels: [] };
      expect(shouldSkipChangelog(pr, BEHAVIOR_MODES.AUTO, [])).toBe(true);
    });

    test('returns true for /changelog skip in body', () => {
      const pr = { body: '/changelog skip', labels: [] };
      expect(shouldSkipChangelog(pr, BEHAVIOR_MODES.AUTO, [])).toBe(true);
    });

    test('returns true when PR has a skip label', () => {
      const pr = { body: '', labels: [{ name: 'skip-changelog' }] };
      expect(shouldSkipChangelog(pr, BEHAVIOR_MODES.AUTO, ['skip-changelog'])).toBe(true);
    });

    test('returns false when PR labels do not match skip labels', () => {
      const pr = { body: '', labels: [{ name: 'feature' }] };
      expect(shouldSkipChangelog(pr, BEHAVIOR_MODES.AUTO, ['skip-changelog'])).toBe(false);
    });

    test('handles null body', () => {
      const pr = { body: null, labels: [] };
      expect(shouldSkipChangelog(pr, BEHAVIOR_MODES.AUTO, [])).toBe(false);
    });

    test('handles string labels', () => {
      const pr = { body: '', labels: ['dependencies'] };
      expect(shouldSkipChangelog(pr, BEHAVIOR_MODES.AUTO, ['dependencies'])).toBe(true);
    });
  });

  describe('opt-in mode', () => {
    test('returns true when checkbox is not checked', () => {
      const pr = { body: '- [ ] auto-generate changelog', labels: [] };
      expect(shouldSkipChangelog(pr, BEHAVIOR_MODES.OPT_IN, [])).toBe(true);
    });

    test('returns false when checkbox is checked', () => {
      const pr = { body: '- [x] auto-generate changelog', labels: [] };
      expect(shouldSkipChangelog(pr, BEHAVIOR_MODES.OPT_IN, [])).toBe(false);
    });

    test('returns true when no checkbox at all', () => {
      const pr = { body: 'no checkbox here', labels: [] };
      expect(shouldSkipChangelog(pr, BEHAVIOR_MODES.OPT_IN, [])).toBe(true);
    });
  });
});

// ─── parseCommentCommands ───────────────────────────────────────────────────
describe('parseCommentCommands', () => {
  const trigger = '/changelog:';

  test('returns null for empty comments array', () => {
    expect(parseCommentCommands([], trigger)).toBeNull();
  });

  test('returns null for null comments', () => {
    expect(parseCommentCommands(null, trigger)).toBeNull();
  });

  test('detects /changelog skip', () => {
    const comments = [{ body: '/changelog skip', created_at: '2024-01-01T00:00:00Z' }];
    const result = parseCommentCommands(comments, trigger);
    expect(result.command).toBe(COMMENT_COMMANDS.SKIP);
  });

  test('detects /changelog: skip', () => {
    const comments = [{ body: '/changelog: skip', created_at: '2024-01-01T00:00:00Z' }];
    const result = parseCommentCommands(comments, trigger);
    expect(result.command).toBe(COMMENT_COMMANDS.SKIP);
  });

  test('detects /changelog regenerate', () => {
    const comments = [{ body: '/changelog regenerate', created_at: '2024-01-01T00:00:00Z' }];
    const result = parseCommentCommands(comments, trigger);
    expect(result.command).toBe(COMMENT_COMMANDS.REGENERATE);
  });

  test('detects /changelog: regenerate', () => {
    const comments = [{ body: '/changelog: regenerate', created_at: '2024-01-01T00:00:00Z' }];
    const result = parseCommentCommands(comments, trigger);
    expect(result.command).toBe(COMMENT_COMMANDS.REGENERATE);
  });

  test('detects /changelog: custom text', () => {
    const comments = [{ body: '/changelog: my custom entry', created_at: '2024-01-01T00:00:00Z' }];
    const result = parseCommentCommands(comments, trigger);
    expect(result.command).toBe('custom');
    expect(result.text).toBe('my custom entry');
  });

  test('latest comment wins', () => {
    const comments = [
      { body: '/changelog: old entry', created_at: '2024-01-01T00:00:00Z' },
      { body: '/changelog: new entry', created_at: '2024-01-02T00:00:00Z' }
    ];
    const result = parseCommentCommands(comments, trigger);
    expect(result.command).toBe('custom');
    expect(result.text).toBe('new entry');
  });

  test('returns null when no commands found', () => {
    const comments = [
      { body: 'just a regular comment', created_at: '2024-01-01T00:00:00Z' }
    ];
    expect(parseCommentCommands(comments, trigger)).toBeNull();
  });

  test('handles multi-line comment body', () => {
    const comments = [{
      body: 'Some context here\n/changelog: the entry\nMore text',
      created_at: '2024-01-01T00:00:00Z'
    }];
    const result = parseCommentCommands(comments, trigger);
    expect(result.command).toBe('custom');
    expect(result.text).toBe('the entry');
  });
});

// ─── resolveEntryAction ─────────────────────────────────────────────────────
describe('resolveEntryAction', () => {
  test('skip via comment command has highest priority', () => {
    const result = resolveEntryAction(
      ENTRY_STATE.NONE,
      { command: 'custom', text: 'ignored' },
      { command: COMMENT_COMMANDS.SKIP },
      true
    );
    expect(result.action).toBe('skip');
  });

  test('skip via description command', () => {
    const result = resolveEntryAction(
      ENTRY_STATE.NONE,
      { command: COMMENT_COMMANDS.SKIP },
      null,
      true
    );
    expect(result.action).toBe('skip');
  });

  test('regenerate via comment command overrides preserve', () => {
    const result = resolveEntryAction(
      ENTRY_STATE.AUTO_EDITED,
      null,
      { command: COMMENT_COMMANDS.REGENERATE },
      true
    );
    expect(result.action).toBe('regenerate');
    expect(result.mark).toBe(true);
  });

  test('custom text from description (priority 3)', () => {
    const result = resolveEntryAction(
      ENTRY_STATE.NONE,
      { command: 'custom', text: 'my entry' },
      null,
      true
    );
    expect(result.action).toBe('custom');
    expect(result.mark).toBe(false);
    expect(result.text).toBe('my entry');
  });

  test('custom text from comment (priority 4)', () => {
    const result = resolveEntryAction(
      ENTRY_STATE.NONE,
      null,
      { command: 'custom', text: 'comment entry' },
      true
    );
    expect(result.action).toBe('custom');
    expect(result.mark).toBe(false);
  });

  test('description custom takes precedence over comment custom', () => {
    const result = resolveEntryAction(
      ENTRY_STATE.NONE,
      { command: 'custom', text: 'from desc' },
      { command: 'custom', text: 'from comment' },
      true
    );
    expect(result.action).toBe('custom');
    expect(result.text).toBe('from desc');
  });

  test('generates for NONE state', () => {
    const result = resolveEntryAction(ENTRY_STATE.NONE, null, null, true);
    expect(result.action).toBe('generate');
    expect(result.mark).toBe(true);
  });

  test('generates for AUTO_UNTOUCHED state', () => {
    const result = resolveEntryAction(ENTRY_STATE.AUTO_UNTOUCHED, null, null, true);
    expect(result.action).toBe('generate');
    expect(result.mark).toBe(true);
  });

  test('preserves AUTO_EDITED when preserve is true', () => {
    const result = resolveEntryAction(ENTRY_STATE.AUTO_EDITED, null, null, true);
    expect(result.action).toBe('preserve');
  });

  test('preserves MANUAL when preserve is true', () => {
    const result = resolveEntryAction(ENTRY_STATE.MANUAL, null, null, true);
    expect(result.action).toBe('preserve');
  });

  test('generates over AUTO_EDITED when preserve is false', () => {
    const result = resolveEntryAction(ENTRY_STATE.AUTO_EDITED, null, null, false);
    expect(result.action).toBe('generate');
    expect(result.mark).toBe(true);
  });

  test('generates over MANUAL when preserve is false', () => {
    const result = resolveEntryAction(ENTRY_STATE.MANUAL, null, null, false);
    expect(result.action).toBe('generate');
    expect(result.mark).toBe(true);
  });

  test('mark is true for auto-generated entries', () => {
    const result = resolveEntryAction(ENTRY_STATE.NONE, null, null, true);
    expect(result.mark).toBe(true);
  });

  test('mark is false for custom entries', () => {
    const result = resolveEntryAction(
      ENTRY_STATE.NONE,
      { command: 'custom', text: 'x' },
      null,
      true
    );
    expect(result.mark).toBe(false);
  });
});

// ─── updateChangelog (with marker support) ──────────────────────────────────
describe('updateChangelog', () => {
  const tmpDir = path.join(__dirname, '.test-tmp');
  const tmpFile = path.join(tmpDir, 'CHANGELOG.md');

  beforeEach(() => {
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    // Clean up any existing file
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  });

  afterAll(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('creates new changelog when file does not exist', async () => {
    const entries = [{
      type: 'feat', scope: 'auth', description: 'add login',
      prNumber: 1, prUrl: 'https://github.com/o/r/pull/1', section: 'Features'
    }];
    const result = await updateChangelog(tmpFile, entries);
    expect(result).toBe(true);
    const content = fs.readFileSync(tmpFile, 'utf8');
    expect(content).toContain('## [Unreleased]');
    expect(content).toContain('### Features');
    expect(content).toContain('add login');
    expect(content).toContain('[#1]');
  });

  test('adds marker when markEntries is true', async () => {
    const entries = [{
      type: 'feat', scope: null, description: 'new feature',
      prNumber: 42, prUrl: 'https://github.com/o/r/pull/42', section: 'Features'
    }];
    const result = await updateChangelog(tmpFile, entries, { markEntries: true });
    expect(result).toBe(true);
    const content = fs.readFileSync(tmpFile, 'utf8');
    expect(content).toMatch(/<!-- ac:[a-f0-9]{8}:42 -->/);
  });

  test('does not add marker when markEntries is false or absent', async () => {
    const entries = [{
      type: 'feat', scope: null, description: 'no marker',
      prNumber: 10, prUrl: 'https://github.com/o/r/pull/10', section: 'Features'
    }];
    await updateChangelog(tmpFile, entries);
    const content = fs.readFileSync(tmpFile, 'utf8');
    expect(content).not.toMatch(/<!-- ac:/);
  });

  test('replaces existing entry for same PR', async () => {
    // First write
    const entries1 = [{
      type: 'feat', scope: null, description: 'old text',
      prNumber: 5, prUrl: 'url', section: 'Features'
    }];
    await updateChangelog(tmpFile, entries1);

    // Second write with updated text
    const entries2 = [{
      type: 'feat', scope: null, description: 'new text',
      prNumber: 5, prUrl: 'url', section: 'Features'
    }];
    await updateChangelog(tmpFile, entries2);

    const content = fs.readFileSync(tmpFile, 'utf8');
    expect(content).toContain('new text');
    expect(content).not.toContain('old text');
  });

  test('removes entry by hash marker during update', async () => {
    // Write an entry with marker
    const entries1 = [{
      type: 'feat', scope: null, description: 'marked entry',
      prNumber: 77, prUrl: 'url', section: 'Features'
    }];
    await updateChangelog(tmpFile, entries1, { markEntries: true });

    // Update with new entry for same PR
    const entries2 = [{
      type: 'feat', scope: null, description: 'replaced entry',
      prNumber: 77, prUrl: 'url', section: 'Features'
    }];
    await updateChangelog(tmpFile, entries2, { markEntries: true });

    const content = fs.readFileSync(tmpFile, 'utf8');
    expect(content).toContain('replaced entry');
    expect(content).not.toContain('marked entry');
    // Should have exactly one marker for PR 77
    const markers = content.match(/<!-- ac:[a-f0-9]{8}:77 -->/g);
    expect(markers).toHaveLength(1);
  });
});

// ─── Integration: hash marker round-trip ────────────────────────────────────
describe('hash marker round-trip', () => {
  test('buildMarkedEntry then detectEntryState returns AUTO_UNTOUCHED', () => {
    const entryText = '**auth**: add JWT tokens ([#123](url))';
    const marked = buildMarkedEntry(entryText, 123);
    const changelog = `# Changelog\n\n## [Unreleased]\n\n### Features\n- ${marked}\n`;
    const state = detectEntryState(changelog, 123);
    expect(state.state).toBe(ENTRY_STATE.AUTO_UNTOUCHED);
  });

  test('editing marked entry changes state to AUTO_EDITED', () => {
    const entryText = '**auth**: add JWT tokens ([#123](url))';
    const marked = buildMarkedEntry(entryText, 123);
    // Simulate user editing the entry text but keeping the marker
    const edited = marked.replace('add JWT tokens', 'add OAuth tokens');
    const changelog = `# Changelog\n\n## [Unreleased]\n\n### Features\n- ${edited}\n`;
    const state = detectEntryState(changelog, 123);
    expect(state.state).toBe(ENTRY_STATE.AUTO_EDITED);
  });

  test('removing marker makes entry MANUAL', () => {
    const entryText = '**auth**: add JWT tokens ([#123](url))';
    // Entry without marker
    const changelog = `# Changelog\n\n## [Unreleased]\n\n### Features\n- ${entryText}\n`;
    const state = detectEntryState(changelog, 123);
    expect(state.state).toBe(ENTRY_STATE.MANUAL);
  });
});

// ─── Constants sanity checks ────────────────────────────────────────────────
describe('constants', () => {
  test('ENTRY_STATE has all expected values', () => {
    expect(ENTRY_STATE.NONE).toBe('NONE');
    expect(ENTRY_STATE.AUTO_UNTOUCHED).toBe('AUTO_UNTOUCHED');
    expect(ENTRY_STATE.AUTO_EDITED).toBe('AUTO_EDITED');
    expect(ENTRY_STATE.MANUAL).toBe('MANUAL');
    expect(ENTRY_STATE.SKIPPED).toBe('SKIPPED');
  });

  test('BEHAVIOR_MODES has auto and opt-in', () => {
    expect(BEHAVIOR_MODES.AUTO).toBe('auto');
    expect(BEHAVIOR_MODES.OPT_IN).toBe('opt-in');
  });

  test('HASH_MARKER.PATTERN matches valid markers', () => {
    const marker = '<!-- ac:a1b2c3d4:123 -->';
    const match = marker.match(HASH_MARKER.PATTERN);
    expect(match).toBeTruthy();
    expect(match[1]).toBe('a1b2c3d4');
    expect(match[2]).toBe('123');
  });

  test('HASH_MARKER.template produces valid marker', () => {
    const marker = HASH_MARKER.template('abcd1234', 42);
    expect(marker).toBe('<!-- ac:abcd1234:42 -->');
    expect(marker.match(HASH_MARKER.PATTERN)).toBeTruthy();
  });
});
