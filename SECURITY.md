# Security Policy

## Reporting a vulnerability

Do not disclose vulnerabilities in public issues. Use GitHub's private vulnerability reporting for this repository when available, or contact the repository maintainer through GitHub.

## Project rules

- Never commit provider API keys, OAuth tokens, credentials, private media or user secrets.
- Project files and diagnostic bundles must not contain provider credentials.
- Reported security issues should include affected version, reproduction steps and impact, with secrets redacted.
- Filesystem access and process execution must remain behind the Rust permission boundary.
