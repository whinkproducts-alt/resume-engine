// Conventional Commits: <type>(<scope>): <subject>
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [2, 'always',
      ['feat', 'fix', 'chore', 'docs', 'refactor', 'test', 'perf', 'ci', 'build']],
    'scope-enum': [2, 'always',
      ['web', 'api', 'shared', 'rules', 'renderer', 'qa', 'storage', 'worker', 'docs', 'infra', 'ci', 'deps']],
  },
};
