# Agent Studio — guide för teamet

Den här guiden tar dig från noll till en Copilot-agent som hela teamet kan använda. Räkna med 20–30 minuter första gången.

**Bilden att ha i huvudet:** agenten är *kocken* (vem den är, hur den jobbar, vad den aldrig gör). Skills är *recepten* (när de används, stegen, hur svaret ska se ut). Agent Studio gör om kokboken till ett app-paket som Microsoft 365 Copilot förstår.

---

## Innan du börjar

| Behöver du | Varför |
| --- | --- |
| `agent-studio.html` | Själva verktyget. En fil, öppnas i Edge eller Chrome. Ingen installation. |
| Microsoft 365 Copilot-licens | För att kunna chatta med agenten i Copilot. |
| Rätt att ladda upp anpassade appar | Kontrollera: Teams → **Appar** → **Hantera dina appar** → finns knappen **Ladda upp en app**? Saknas den: be IT-administratören slå på *Upload custom apps* i Teams Admin Center (**Teams apps → Setup policies**). |
| (Valfritt) Jira-anslutning | Om agenten ska läsa Jira via en Copilot-anslutning (Graph connector) behöver ni anslutnings-id:t från administratören. |

> **Inget lämnar datorn.** Agent Studio skickar ingenting någonstans. Utkast sparas i webbläsarens lokala lagring på din dator. Använd **Säkerhetskopiera** för att flytta dem.

---

## Del 1 — Bygg agenten

### 1. Öppna verktyget
Dubbelklicka på `agent-studio.html`. Den fungerar direkt från disk, USB, en delad mapp eller SharePoint (ladda ner filen först).

### 2. Välj en start
- **Snabbstart: Kundtjänstagent** — tre fält och du är klar. Bra för en första demo.
- **Börja från en mall** — 14 kokböcker: Kundtjänst, Incident, XML/integration, Uppskattning, Månadsrapport, Kunskapsbas, Möten, Offert, Onboarding, Versionsanteckningar, Testfall, Mappningsspec, Rotorsaksanalys (5 varför) och en tom Startstomme. En teamledare kan exportera flera agenter som ett **teambibliotek**.
- **Importera app-paketet** — öppna en zip som någon annan har gjort (eller som du exporterat tidigare) och fortsätt redigera.

### 3. Identitet
- **Namn** och **Beskrivning** syns i Copilot. Skriv beskrivningen så att en kollega förstår vad agenten är till för på en rad.
- **Webbplats** — skriv er riktiga adress. Integritetspolicy och villkor fylls i automatiskt (`/privacy`, `/terms`); ändra dem under **Visa utgivare och GUID** om ni har andra adresser.
- **Initialer** och **accentfärg** blir agentens ikon. Förhandsgranskningen till höger visar hur det ser ut.

### 4. Skills — kocken och recepten
Överst: **Kocken**.
- **Roll** — börja med "en …" (blir "Du är en …") eller på engelska "a …". Exempel: *en kundtjänstagent för integrationsteamet. Kollegor kommer med Jira-ärenden och utkast till kundsvar.*
- **Arbetssätt** — hur agenten ska jobba (källor först, korta rubriker …).
- **Gränser** — vad agenten aldrig får göra (hitta på ärendenummer, lova datum …).

Under det: **ett kort per skill**. Klicka på ett kort för att öppna det.

| Fält | Skriv så här |
| --- | --- |
| Namn | Ett verb + vad: *Analysera Jira-ärende* |
| Vem och när? | Vem frågar och vad säger de: *En kollega klistrar in ett ärende och undrar varför det står still.* |
| Steg | 3–6 numrerade steg i rätt ordning. |
| Svarsformat | Rubrikerna som svaret alltid ska ha: `## Sammanfattning`, `## Det som saknas`, `## Nästa steg`. |
| Exempel (valfritt) | En kort fråga och ett bra svar. Hamnar bara i SKILL.md-filen. |

Varje kort blir **både** ett avsnitt i agentens instruktioner **och** en egen `SKILL.md`-fil i paketet. Du behöver inte skriva något två gånger.

Tips:
- **Hämta ett recept från mallarna…** lägger till en färdig skill från en annan mall (t.ex. *Classify the incident* i en kundtjänstagent).
- Pilarna ↑ ↓ ändrar ordning. **Ctrl+Z** ångrar om du tar bort fel kort.
- Håll koll på mätaren längst ner: instruktionerna får vara högst **8 000 tecken**.
- Kvalitetspoängen till höger säger vad som saknas (roll, svarsformat, gränser, motsägelser).

### 5. Förmågor
Slå bara på det agenten behöver:
- **OneDrive och SharePoint** — lägg gärna in URL:er till era runbooks, annars söker agenten i allt användaren har åtkomst till.
- **Copilot-anslutningar (Graph)** — t.ex. Jira. Skriv anslutnings-id:t (fås av administratören).
- **E-post, Teams-meddelanden, Personer, Webbsökning** — efter behov.

**API-plugin (valfritt, för de som vill att agenten ska *göra* saker i Jira):**
1. Bocka i **Koppla ett API-plugin (OpenAPI)**.
2. Klicka **Använd Jira Cloud-exemplet** (eller ladda upp er egen OpenAPI 3-fil).
3. Välj operationer: `searchIssues`, `getIssue`, `addComment`.
4. Byt `{yourDomain}` i specifikationen mot er Jira-sajt (t.ex. `acme`).
5. Registrera Jira-token i **Teams Developer Portal → Tools → API key registration** och klistra in **referens-id:t** (inte själva token) i fältet *Referens-id*.

### 6. Startfrågor
Fyra–sex konkreta frågor som visas som knappar i Copilot. Skriv dem som en kollega skulle fråga: *"Analysera det här Jira-ärendet och säg vad som saknas innan vi kan svara kunden."*

### 7. Paket
- Grön ruta = **Redo att exportera**. Röd ruta listar vad som måste fixas.
- Checklistan visar det som brukar glömmas (example.com, referens-id, Jira-adress).
- Under **Innehåll i zip-filen** kan du klicka på varje fil och se exakt vad som skickas med.
- Klicka **Exportera app-paketet (.zip)**.

> Packa **inte** upp och döp **inte** om zip-filen. Teams vill ha den som den är.

---

## Del 2 — Ladda upp och testa

Välj **ett** av sätten nedan.

### A. Teams Developer Portal (rekommenderas)
1. Gå till <https://dev.teams.microsoft.com> och logga in med jobbkontot.
2. **Apps** → **Import app** → välj zip-filen.
3. Granska att namn, ikon och beskrivning ser rätt ut. Portalen validerar paketet igen.
4. Klicka **Preview in Teams** (eller **Publish → Download the app package** om ni vill skicka det vidare).
5. Öppna Copilot (<https://m365.cloud.microsoft/chat> eller Copilot i Teams) → sidopanelen bredvid **Ny chatt** → välj agenten. Det kan ta ett par minuter innan den syns; ladda om sidan.

### B. Ladda upp direkt i Teams (snabbast för egen test)
1. Teams → **Appar** → **Hantera dina appar** → **Ladda upp en app** → **Ladda upp en anpassad app**.
2. Välj zip-filen → **Lägg till**.
3. Öppna Copilot → sidopanelen → välj agenten, eller skriv `@Agentnamn` i en Copilot-chatt.

### C. Microsoft 365 Agents Toolkit i VS Code (för utvecklare)
1. Installera tillägget *Microsoft 365 Agents Toolkit*.
2. Skapa ett nytt projekt: **Declarative Agent** (utan plugin, eller *Add plugin → Start with an OpenAPI Description Document* om ni har ett API).
3. Ersätt filerna i `appPackage/` med filerna från zip-filen (`manifest.json`, `declarativeAgent.json`, `instruction.txt`, ikoner, `skills/`, och vid plugin `plugin.json` + `openapi.yaml`).
4. **Lifecycle → Provision**, och sedan **Preview in Copilot (Edge/Chrome)** i Run and Debug.

### Testa
- Klicka på startfrågorna.
- Kör testfrågorna från panelen **Testfrågor** i Agent Studio — de är skrivna för just din mall.
- Fråga också *"Vad kan du inte hjälpa mig med?"* — svaret ska spegla era gränser.
- Om svaret blir vagt: gå tillbaka till skillkortet, skärp stegen eller svarsformatet, exportera igen och **höj versionen** (Identitet → Visa utgivare och GUID → Appversion, t.ex. `1.0.1`). Ladda upp den nya zip-filen ovanpå den gamla.

---

## Del 3 — Dela med teamet

| Sätt | Hur | Passar när |
| --- | --- | --- |
| Dela zip-filen | Skicka zip-filen; varje kollega laddar upp den själv (Del 2 B). | Liten pilot, 2–5 personer. |
| Organisationens appkatalog | Teams Developer Portal → **Publish → Publish to your org**. IT godkänner i **Teams Admin Center → Manage apps** eller **Microsoft 365 Admin Center → Integrated apps**. | Hela teamet eller avdelningen. |
| Dela projektet, inte paketet | Paket-steget → **Exportera projekt (.json)**. En kollega importerar den i sin Agent Studio och fortsätter redigera. | När någon annan ska ta över eller granska. |

**Rutin vi rekommenderar:** en person äger agenten, ändringar görs i Agent Studio, projektfilen (`.agent-studio.json`) och zip-filen sparas i teamets SharePoint-mapp med versionsnummer i filnamnet.

---

## Vanliga frågor

**Knappen "Ladda upp en app" saknas.** Tenantpolicy. Be IT slå på *Upload custom apps* för er grupp.

**Agenten syns inte i Copilot.** Vänta 2–5 minuter och ladda om. Kontrollera att du har Copilot-licens.

**Jira-pluginet frågar om bekräftelse.** Det är meningen för `addComment` (skrivåtgärd). Läsning (`searchIssues`, `getIssue`) går direkt.

**"Redo att exportera" men varningar kvar.** Varningar stoppar inte exporten (t.ex. `example.com`), men fixa dem innan ni delar agenten med fler.

**Var finns mina utkast?** I webbläsaren på den här datorn. Byter du dator eller webbläsare: **Säkerhetskopiera** och importera filen på den nya.
