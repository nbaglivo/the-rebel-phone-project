# Licensing

## GPL-3.0-or-later, to keep the phone and its descendants open

- **Context:** the repo had no license, which legally means "all rights
  reserved": readable, but nobody may reuse it. We wanted it fully open
  source before presenting it at FOSDEM.
- **Fact:** FOSDEM accepts any OSI-approved license. MIT and Apache-2.0 are
  the most common choices overall; the Linux-phone stack this sits on
  (postmarketOS tooling, Phosh) is largely GPL-3.0.
- **Our choice:** GPL-3.0-or-later for the whole repo: `LICENSE` holds the
  verbatim text from gnu.org, `package.json` has `"license":
  "GPL-3.0-or-later"`. Copyleft matches the project's sovereignty goal:
  a phone built from this stays inspectable by whoever carries it.
- **Alternatives:** MIT/ISC if you mainly want people to lift snippets into
  differently-licensed projects with no strings; Apache-2.0 for the same plus
  an explicit patent grant; AGPL adds little for software that isn't a
  network service.
- **Cost / gotchas:** anyone who copies code (not ideas) from here into a
  phone they distribute must ship it under GPL too. Ideas and techniques
  aren't covered by copyright, only copied code or text. `vendor/syncd` is a
  separate repo declaring ISC, which is GPL-compatible.
- **Verified:** docs only, 2026-11-20.
