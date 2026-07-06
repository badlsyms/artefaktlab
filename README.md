# ArtefaktLab — Můj Nucleus 2.0

Zdrojová záloha produkční aplikace **Můj Nucleus** pro Google Cloud Run.

- Cloud Run service: `remix-m-j-ai-asistent`
- Project number: `662653350528`
- Region: `europe-west2`
- PWA: `Můj Nucleus`

Aplikace je v adresáři [`nucleus-cloudrun/`](./nucleus-cloudrun/).

## Bezpečnost

Repozitář neobsahuje Gemini API klíč ani jiné provozní tajemství. Backend primárně používá Google Cloud service identity pro Vertex AI a umí použít existující serverový `GEMINI_API_KEY` jako fallback. Klíč se neposílá do prohlížeče.
