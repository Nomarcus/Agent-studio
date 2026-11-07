# Agent Studio — säljpitch

## På en mening
**Agent Studio låter integrations- och supportteam bygga egna Microsoft 365 Copilot-agenter som kokböcker — och få ut ett validerat app-paket på 20 minuter, utan kod och utan att data lämnar datorn.**

## Problemet
- Alla har fått Copilot. Få har fått agenter som kan *deras* arbete: Jira-ärenden, XML-fel, kundsvar, runbooks.
- Att skriva `declarativeAgent.json`, Teams-manifest, `plugin.json` och SKILL.md för hand tar dagar och faller på detaljer (teckengränser, fel schema, en okänd egenskap).
- Copilot Studio är kraftfullt men kräver licenser, miljöer och någon som förvaltar det. Många team vill bara ha *en bra agent som följer våra recept*.

## Lösningen
- **Kokboksmodellen:** agenten är kocken, skills är recepten. Ett kort per skill — vem frågar, stegen, svarsformatet. Det blir både instruktioner och SKILL.md-filer.
- **Färdiga mallar** för kundtjänst/Jira, incidenter, XML/integration, uppskattningar, månadsrapporter, kunskapsbas och möten.
- **Riktiga API-plugins:** klistra in OpenAPI, välj operationer, få `plugin.json` v2.4. Jira Cloud-exempel ingår.
- **Kvalitetskontroll** av instruktionerna (saknad roll, vagt språk, saknat svarsformat, motsägelser) och validering mot **Microsofts officiella scheman** (deklarativ agent v1.9, app-manifest 1.29, plugin v2.4).
- **En HTML-fil.** Fungerar offline från USB, mejl eller SharePoint. Inget konto, ingen server, inga kunddata i någon molntjänst.

## Vem köper
| Köpare | Varför |
| --- | --- |
| Integrations-/supportchef | Vill att teamet ska få nytta av Copilot nu, inte efter ett halvårsprojekt. |
| IT/M365-ansvarig | Vill ha agenter som går att granska innan de laddas upp — inget okontrollerat. |
| Microsoft-partner/konsultbolag | Vill leverera "Copilot-agenter på en dag" som ett paketerat erbjudande. |

## Värdet i siffror (räkneexempel)
- En agent för hand: 1–2 dagars arbete för en konsult (8–16 h × ~1 200 kr = **10–20 tkr per agent**).
- Med Agent Studio: 20–60 minuter från mall till uppladdad agent.
- Ett team som bygger 5 agenter första kvartalet sparar **50–100 tkr** i tid — och agenterna går att underhålla av teamet själva.

## Prisförslag
Utgångspunkter för förhandling, exkl. moms.

| Paket | Innehåll | Pris |
| --- | --- | --- |
| **Team** | Agent Studio för ett team (≤ 15 användare), alla mallar, uppdateringar i 12 mån. | **9 900 kr/år** (eller 19 900 kr engångs, evig licens för nuvarande version) |
| **Organisation** | Obegränsat antal team, era egna mallar förinlagda, er logga och färger, prioriterad support. | **39 000 kr/år** |
| **Kom igång-workshop** | Halvdag på plats/distans: vi bygger era första 3 agenter tillsammans, laddar upp och testar i er tenant. Team-licens ingår. | **24 000 kr** |
| **Mallpaket** | Skräddarsydd mall för ett av era flöden (t.ex. er Jira-struktur eller ert XML-format), inklusive API-plugin mot ert API. | **8 000–15 000 kr/mall** |
| **Partner / white-label** | Rätt att leverera Agent Studio under eget varumärke till egna kunder. | **59 000 kr/år** eller 20 % av kundintäkten |

Rekommenderad första affär: **Workshop + Team** (24 000 kr) — låg tröskel, kunden ser tre fungerande agenter samma dag och förlänger licensen själv.

## Invändningar och svar
- **"Vi har redan Copilot Studio."** Bra — Agent Studio är för de team som vill ha en granskbar, versionerad deklarativ agent utan att förvalta en Power Platform-miljö. Paketen är vanliga Microsoft-paket och kan tas vidare i Agents Toolkit.
- **"Är det säkert?"** Ingen data lämnar webbläsaren. Hemligheter (API-nycklar, OAuth) läggs aldrig i paketet; bara referens-id från Teams Developer Portal.
- **"Vad händer när Microsoft ändrar schemat?"** Valideringen bygger på de officiella schemana; nya versioner ingår i årslicensen.
- **"Kan vi inte bara skriva JSON själva?"** Jo. Det tar längre tid, och kvalitetskontrollen av själva instruktionerna — det som avgör om agenten är bra — får ni inte på köpet.

## Demo på 5 minuter
1. Öppna `agent-studio.html` → **Snabbstart: Kundtjänstagent**.
2. Skriv kundens namn och webbplats → **Vidare till export**.
3. Visa **Skills**: ett kort per recept, mätaren och kvalitetspoängen.
4. Visa **Förmågor → Jira Cloud-exemplet** (tre operationer, referens-id).
5. **Paket**: grön ruta, klicka på `SKILL.md` och `plugin.json`, exportera zip.
6. Om kunden har rättigheter: ladda upp i Teams Developer Portal och ställ en startfråga.

## Vad som inte ingår (och kan bli merförsäljning)
- Delad mallkatalog i molnet och inloggning (medvetet offline idag).
- Publicering direkt till Teams Admin Center.
- Visuell designer för Adaptive Cards.
- Live-chatt mot agenten inne i verktyget (förhandsgranskningen är en skiss).
