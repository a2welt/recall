# Security policy

## Reporting a vulnerability

Please do not disclose a suspected vulnerability in a public issue. Use GitHub’s private vulnerability reporting feature for this repository. If it is unavailable, contact the repository owner privately through the contact method listed on the GitHub organization profile.

Include affected versions, reproduction steps, impact, and any suggested mitigation. Do not include real API keys, pairing links, memory databases, or private memory content.

## Security boundaries

- The desktop server is intended to bind to `127.0.0.1` only.
- Readable memories are stored in the local SQLite database.
- Provider credentials are encrypted at rest and decrypted only into process memory after unlock.
- Cloud AI providers receive data only after an explicit generation request.
- The optional mobile relay stores encrypted payloads but still exposes traffic metadata such as timing and payload size.
- A mobile pairing link is a bearer secret. Exposure requires creating a new pairing configuration.

## Not a security boundary

Recall does not protect data from malware or another user account with access to the same operating-system profile. It is not a password manager, secret vault, or substitute for encrypted disk storage and tested backups.
