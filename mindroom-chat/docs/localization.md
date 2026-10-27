# Localization

MindRoom Chat supports English, German, Dutch, Spanish, French, Portuguese, Italian, Simplified Chinese, Traditional Chinese, Japanese, Korean, Hindi, Arabic, Russian, Turkish, Indonesian, and Bengali.
Choose a language under Settings → General → Language.
The selection updates the open interface and is remembered on this browser or device.
Supported browser language preferences are used before a preference is saved.

## Runtime and catalogs

The language registry is in `src/app/i18nLanguages.ts`.
English is bundled in the application; other catalogs load on demand from `public/locales/<language>.json` using the application base path.
English remains the fallback if a catalog cannot load.
Regional language codes resolve to a supported base language, while Chinese script and region preferences distinguish Simplified and Traditional Chinese.

New embedded calls receive the selected language, with fallback handled by Element Call's supported languages.
An active call keeps its starting language to avoid restarting the connection; its accessible frame title updates immediately.

All application-owned messages belong in `src/app/locales/en.json` and the corresponding locale files.
The existing keys and the `sharedUi`, `featureUi`, and `mindroomUi` groups share one typed i18next namespace.
Use `useTranslation` inside components and include the translator in memo or callback dependencies whenever translated output is cached.
Pass a translator into pure presentation helpers instead of storing translated labels in Matrix events, thread records, or persistent caches.

## Writing messages

Translate complete sentences, including interpolated names and counts.
Use i18next plural keys for every category reported by `Intl.PluralRules(language)`; do not concatenate English singular/plural fragments.
Preserve interpolation names and format suffixes, rich-text tags, command syntax, protocol identifiers, product names, package names, and license names exactly.
Room names, messages, tags, server-provided text, and custom deployment copy remain authored content.
Default welcome copy translates unless the deployment supplies its own value.

Use `Trans` for sentences containing components.
When its values contain user or server text, use `shouldUnescape` with `tOptions={{ interpolation: { escapeValue: true } }}` so characters such as `<` and `&` survive rich-text parsing.
Render technical snippets as code and isolate mixed-direction identifiers.
Arabic interpolations use first-strong-isolate and pop-directional-isolate around each placeholder.

## Dates and direction

Use the active application locale with Intl and the shared Day.js locale helpers in `src/app/appLocale.ts`.
Prefer logical CSS properties such as `paddingInlineStart` and `insetInlineEnd` for interface layout.
Navigation arrows mirror in Arabic, while media time, code, URLs, and technical identifiers retain their own direction.
Messages and editors use automatic text direction so the language of authored content remains independent of the interface.

## Native iOS strings

Notification templates and system permission explanations live in `ios/App/App/<locale>.lproj`.
Keep positional notification substitutions unchanged and isolate Arabic substitutions.
Register added files and regions in `ios/App/App.xcodeproj/project.pbxproj`.
Web Chinese codes map to the native `zh-Hans` and `zh-Hant` resource directories.
System permission prompts follow the iOS language setting.

## Validation

Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`.
Catalog tests check logical key coverage, native plural categories, interpolation and markup parity, literal technical tokens, and empty values.
Runtime tests cover language normalization, date formatting, document direction, and locale requests under subpath hosting.
Native tests check notification placeholders, permission resources, and Xcode registration.

With a local Matrix test account configured, run `npx playwright test e2e/live/i18n-complete-live.spec.ts`.
The browser checks exercise actual language selection, persistence, Arabic mobile layout, both Chinese scripts and Japanese selection, and authored summaries across room overview and thread banner surfaces.
New UI strings and grammar still require human review in the relevant language; structural catalog checks cannot establish translation quality.
