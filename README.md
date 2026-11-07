# Agent Studio

Ett komplett verktyg i webbläsaren för att **designa, kvalitetssäkra och exportera deklarativa agenter till Microsoft 365 Copilot**. Inget konto, ingen backend, en enda HTML-fil som fungerar offline.

**Ny i teamet?** Läs [docs/Guide-sv.md](docs/Guide-sv.md) — steg för steg från mall till agent i Copilot.
**Ska du sälja eller presentera det?** Se [docs/pitch-sv.md](docs/pitch-sv.md).

Tänk kokbok: agenten är kocken (vem), skills är recepten (hur). Det är samma bild som ni använder när ni introducerar Copilot-agenter i integrationsteamet.

## Vad du får ut

En färdig zip att sideloada eller lämna till Teams Developer Portal / Microsoft 365 Agents Toolkit:

- `manifest.json` — Microsoft 365-appmanifest **1.29**
- `declarativeAgent.json` — deklarativ agent **v1.9**
- `instruction.txt` — samma instruktioner i läsbar text
- `skills/<namn>/SKILL.md` — en fil per skill (när, steg, svarsformat, exempel)
- `color.png` (192×192) och `outline.png` (32×32)
- valfritt: `plugin.json` (schema v2.4) + `openapi.yaml` om du kopplar ett API-plugin

Paket valideras mot de officiella JSON-schemana från Microsoft (nedladdade hit, ingen CDN), inklusive format som `uri` (via vendorad ajv-formats).

## Öppna appen

**Alternativ A — en fil, ingen server** (rekommenderas för USB / mejl / SharePoint):

Öppna `dist/agent-studio.html` direkt (fungerar via `file://`). Bygg om den med `npm run build`.

Leveransen till en kund eller ett team är `agent-studio.zip` (`npm run release`): appen, README, guiden, säljpitchen och ett exempelpaket.

**Alternativ B — utvecklarläge från mappen:**

```bash
python3 -m http.server 4173
```

Öppna [http://localhost:4173](http://localhost:4173).

Du kan också lägga hela mappen (eller bara `dist/agent-studio.html`) på GitHub Pages, Azure Static Web Apps, Netlify, SharePoint eller en intern IIS/nginx. Inga miljövariabler behövs.

Utkast sparas automatiskt i webbläsarens `localStorage`. Använd **Teambibliotek** för att exportera eller importera flera agenter som en fil, eller exportera ett enskilt projekt som JSON. Ctrl+Z ångrar ändringar.

## Skapa och publicera en agent

1. **Startsidan:** välj *Snabbstart: Kundtjänstagent* eller en mall, eller importera en zip.
2. **Identitet:** namn, beskrivning, er webbplats (byt bort `example.com`), färg och ikon-initialer.
3. **Skills:** överst *kocken* (roll, arbetssätt, gränser). Sedan ett kort per skill: *vem och när*, *steg*, *svarsformat* och valfritt exempel. Varje kort blir både ett avsnitt i instruktionerna och en `SKILL.md`. *Hämta ett recept från mallarna…* lägger till färdiga skills. Max 8 000 tecken instruktioner — mätaren visar läget.
4. **Förmågor:** SharePoint, Copilot-anslutningar (t.ex. Jira), e-post, Teams … och valfritt ett API-plugin från OpenAPI.
5. **Startfrågor:** knapparna som visas i Copilot.
6. **Paket:** grön ruta = redo. Checklistan visar det som brukar glömmas. Klicka på valfri fil i zip-innehållet för att se den. Exportera.
7. Ladda upp i **Teams Developer Portal** (Apps → Import app), direkt i **Teams** (Appar → Hantera dina appar → Ladda upp en app) eller via **Microsoft 365 Agents Toolkit**. Detaljer i [guiden](docs/Guide-sv.md).
8. Testa med frågorna i testpanelen.

## Mallar

| Mall | Till för |
| --- | --- |
| Kundtjänstagent | Jira-ärenden, dokumentation, kundsvar |
| Incidentanalytiker | Klassificering, tidslinje, hypotes, kommunikation |
| XML- och integrationsanalytiker | Payload, diff, mappning, tester |
| Uppskattningshjälpen | Nedbrytning, antaganden, tidsintervall |
| Månadsrapportören | Höjdpunkter, trender, ledningssammanfattning |
| Kunskapsbas-författaren | Runbooks och FAQ |
| Mötesanteckaren | Beslut och åtgärder |
| Offertskrivaren | Scope, offerttext, antaganden och undantag |
| Onboarding-kompisen | Första veckorna, arbetssätt och trygga svar |
| Versionsantecknaren | Användarvända notes och tillkännagivanden |
| Testfallsskrivaren | Testfall från krav, utan påhittat beteende |
| Mappningsspecen | Fältmappning för XML/JSON-integrationer |
| Rotorsaksanalytikern | Fem varför och ärlig rotorsaksanalys |
| Startstomme | Tunn kokbok att bygga vidare på |

## Utveckling

```bash
npm test          # 47 enhetstester: generering, scheman, zip-roundtrip, skills, i18n, teambibliotek
npm run e2e       # bygger dist och kör Playwright (system-Chrome) via file:// och http://, skriver shots/, kör axe-core
npm run release   # dist + exempelpaket + agent-studio.zip
npm run vendor    # bygger om vendor/ajv.esm.js (Ajv + ajv-formats i en bundle)
```

Ingen nätverksåtkomst krävs efter att schemana och biblioteken ligger i mappen.

## API-plugin

På steget Förmågor kan du ladda upp eller klistra in en OpenAPI 3-specifikation (YAML eller JSON), välja operationer och generera ett giltigt API-plugin-manifest enligt [schema v2.4](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/plugin-manifest-2.4). Autentisering är `None`, `OAuthPluginVault` eller `ApiKeyPluginVault` med ett referens-id från Teams Developer Portal — aldrig själva hemligheten. Varje vald operation kan få response semantics (JSONPath + Adaptive Card) och bekräftelsedialog.

Kundtjänstagenten kommer med ett färdigt Jira Cloud-urval: sök ärenden (`searchIssues`), hämta ett ärende (`getIssue`) och lägg till kommentar (`addComment`). Byt servervariabeln `yourDomain` och referens-id:t `jira-api-key` innan ni sideloadar mot en riktig sajt.

## Begränsningar

- Mallarnas instruktioner och skills är skrivna på engelska; startfrågor och testfrågor är på svenska, och agenten svarar på användarens språk. Vill ni ha svenska instruktioner: skriv rollen som ”en …” (blir ”Du är en …”) och skillkorten på svenska.
- Inbäddad kunskap (EmbeddedKnowledge) packas in i zip-filen här, men funktionen är fortfarande begränsad hos Microsoft.
- `worker_agents` är preview hos Microsoft.
- Förhandsgranskningen i sidopanelen är en visuell skiss av hur agenten kan se ut i Copilot, inte en live-anslutning till er tenant.
- Agent Studio publicerar ingenting åt er. Zip-filen lämnar datorn först när ni själva laddar upp den.

## Licens

Intern användning. Officiella scheman tillhör Microsoft och ligger i `schemas/` som referens för validering.
