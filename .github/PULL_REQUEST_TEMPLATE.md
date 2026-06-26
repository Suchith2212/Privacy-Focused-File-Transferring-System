## Summary

<!-- One or two sentences describing what this PR does and why. -->

## Type of Change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor (no functional change)
- [ ] Documentation update
- [ ] Schema change
- [ ] Security fix

## Related Issue

Closes #<!-- issue number -->

## Changes Made

<!-- List the files changed and what was changed in each. -->

- `file.js` — 
- `init_schema.sql` — 

## Checklist

- [ ] `npm run lint` passes with no errors
- [ ] Schema initialises cleanly: `mysql -u root -p < Ghost_Drop/backend/sql/init_schema.sql`
- [ ] If an env variable was added, it is documented in `.env.example` with a comment
- [ ] If a DB index was added, it is also handled in `services/schemaOptimization.js`
- [ ] If a new table was added, it is documented in `Ghost_Drop/README.md`
- [ ] Manual test: vault create → upload → access → download flow works end-to-end
- [ ] `git status` confirms no credentials are staged (`.env`, `service_account.json`, `oauth_credentials.json`)

## Security Impact

<!-- Does this change touch cryptography, token handling, rate limiting, session management, or integrity hashing? Describe the security implications. -->

None / describe:

## Screenshots or Logs

<!-- If applicable, include screenshots or redacted log snippets. -->
