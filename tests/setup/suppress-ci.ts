/**
 * GitHub Actions sets CI=true, and the CLI treats that as `--ci` (quiet JSON).
 * The suite is written for the human-readable CLI. Clear the markers before each
 * file; a test that needs CI sets the variable itself.
 */
const CI_ENV_VARS = [
  "CI",
  "GITHUB_ACTIONS",
  "GITLAB_CI",
  "JENKINS_URL",
  "TRAVIS",
  "CIRCLECI",
  "BITBUCKET_PIPELINES",
  "TF_BUILD",
  "CODEBUILD_BUILD_ID",
];

for (const name of CI_ENV_VARS) delete process.env[name];
