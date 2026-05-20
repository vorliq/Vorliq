# Release Metadata Audit

Vorliq already exposed version and release information in several places: the README version badge, `CHANGELOG.md`, `RELEASE_NOTES_v1.0.md`, package versions in the SDK, frontend, and mobile apps, the backend `/api/version` and `/api/deployment` routes, the network manifest, GitHub Actions workflows, and scattered documentation pages such as API versioning, setup, deploy, operator, audit, and transparency.

The information was safe but scattered. Some values were current package versions, some were release notes, some were runtime deployment commits, and some were documentation links. There was no single public metadata file, no structured changelog endpoint, no roadmap endpoint, and no product UI for users to understand release channel, compatibility, or upgrade guidance.

Users need a simple place to see the live version, release channel, recent changes, roadmap status, and honest disclaimers. Developers need stable API and SDK compatibility notes, changelog entries, docs links, and version metadata. Node operators need upgrade instructions, backup reminders, health-check steps, and a way to verify deployment and storage status after updating.
