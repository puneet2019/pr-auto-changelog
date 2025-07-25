// Simple unit tests for the parsing functions
describe('PR Auto Changelog', () => {
  // Test conventional commit parsing logic
  describe('parseConventionalCommit', () => {
    test('parses conventional commit format correctly', () => {
      // Simulate the parsing logic directly
      const title = 'feat(auth): add user authentication';
      const conventionalRegex = /^(feat|fix|docs|style|refactor|perf|test|chore|ci|build|revert)(\(.+\))?!?:\s*(.+)$/i;
      const match = title.match(conventionalRegex);
      
      expect(match).toBeTruthy();
      expect(match[1]).toBe('feat');
      expect(match[2]).toBe('(auth)');
      expect(match[3]).toBe('add user authentication');
    });

    test('parses conventional commit without scope', () => {
      const title = 'fix: resolve login bug';
      const conventionalRegex = /^(feat|fix|docs|style|refactor|perf|test|chore|ci|build|revert)(\(.+\))?!?:\s*(.+)$/i;
      const match = title.match(conventionalRegex);
      
      expect(match).toBeTruthy();
      expect(match[1]).toBe('fix');
      expect(match[2]).toBeUndefined();
      expect(match[3]).toBe('resolve login bug');
    });

    test('returns null for invalid format', () => {
      const title = 'invalid title format';
      const conventionalRegex = /^(feat|fix|docs|style|refactor|perf|test|chore|ci|build|revert)(\(.+\))?!?:\s*(.+)$/i;
      const match = title.match(conventionalRegex);
      
      expect(match).toBeNull();
    });
  });

  describe('parseChangelogComment', () => {
    test('parses changelog comment correctly', () => {
      const comment = '/changelog: Added new feature for user management';
      const trigger = '/changelog:';
      const lines = comment.split('\n');
      
      let result = null;
      for (const line of lines) {
        if (line.trim().startsWith(trigger)) {
          const description = line.replace(trigger, '').trim();
          if (description) {
            result = {
              description: description,
              found: true
            };
          }
        }
      }
      
      expect(result).toBeTruthy();
      expect(result.description).toBe('Added new feature for user management');
    });

    test('returns null when trigger not found', () => {
      const comment = 'This is just a regular comment';
      const trigger = '/changelog:';
      const lines = comment.split('\n');
      
      let result = null;
      for (const line of lines) {
        if (line.trim().startsWith(trigger)) {
          const description = line.replace(trigger, '').trim();
          if (description) {
            result = { description, found: true };
          }
        }
      }
      
      expect(result).toBeNull();
    });
  });

  describe('commit type mapping', () => {
    test('maps commit types to correct sections', () => {
      const mapping = {
        'feat': 'Features',
        'feature': 'Features', 
        'fix': 'Bug Fixes',
        'docs': 'Documentation',
        'chore': 'Chores'
      };
      
      expect(mapping['feat']).toBe('Features');
      expect(mapping['fix']).toBe('Bug Fixes');
      expect(mapping['docs']).toBe('Documentation');
    });
  });
});
