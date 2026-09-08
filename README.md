# Lagbyggaren

Fristående handbollsapp med HK Ankarets utseende. Spelartrupp, nivå 1–3 i halvsteg, 1–3 lag, 6+1 eller 4+1, positionstäckning, nivåanpassning och varierade lagkamrater. Lag visas sida vid sida vid granskning.

## Webbversioner

- GitHub Pages: https://hakanramberg.github.io/lagbyggaren/ — fungerar med lokal webbläsarlagring tills Cloudflare är anslutet.
- Cloudflare: Workers + D1 + Access. Samma kod, men gemensam trupp, e-postinloggning, tränarröster och sparad historik. Publicering kräver Cloudflare-kontot och Access-inställningarna nedan.

GitHub innehåller endast kod. Spelaruppgifter, inloggningsnycklar och huvudtränarens e-postadress publiceras inte i repositoryt.

## Gemensamt arbetsflöde

1. Huvudtränaren loggar in genom Cloudflare Access och får en tom gemensam grupp vid första inloggningen.
2. Lägg till tränare med namn och e-postadress under Tränare. Skicka appens webbadress till dem. Appen skickar inga inbjudningsmejl. Access hanterar engångskoden vid inloggning.
3. Alla godkända tränare kan läsa och redigera truppen, inklusive utvecklingsnivåer, samt granska lagförslag. Endast huvudtränaren hanterar åtkomst och import av historik.
4. Ett förslag kan godkännas eller få en justeringsröst med kommentar. Alla inbjudna tränare måste godkänna aktuell version innan lagen sparas som accepterade. En ny version nollställer rösterna.
5. Accepterade lag är låsta kopior. Namnändringar i truppen ändrar inte tidigare lag. De tio senast accepterade tillfällena används för att prioritera nya lagkamrater; positioner och nivå vägs också in.

## Gratisnivå

Använd **Workers Free**, **D1 på Free** och **Cloudflare Access Free**. Projektet innehåller ingen uppgradering till betald plan. Kontrollera kontots befintliga plan före publicering; en betald plan ska inte aktiveras för detta projekt.

Enligt Cloudflares dokumentation kontrollerad 2026-09-08 har Workers Free 100 000 anrop per dygn och 10 ms CPU per anrop. D1 Free har 5 miljoner lästa rader, 100 000 skrivna rader per dygn och 5 GB total lagring. Dessa är kontogränser, inte reserverade för denna app. Vid överskridna gratisgränser kan tjänsten sluta svara fram till återställning; appen uppgraderar inte kontot.

Lagberäkningen görs i webbläsaren. Synkronisering sker var 30:e sekund och pausas i dolda flikar eller efter fem minuters inaktivitet. Appen begränsar gruppen till 20 tränare, 200 spelare och 750 000 byte sparat innehåll för att hålla beräkning och datatrafik små. Historiken tas aldrig bort automatiskt när gränsen nås.

Referenser: https://developers.cloudflare.com/workers/platform/pricing/ och https://developers.cloudflare.com/d1/platform/pricing/.

## Publicera på Cloudflare

Krav: Node 24, pnpm, ett Cloudflare-konto på gratisnivån och en konfigurerad Cloudflare Access-organisation. `pnpm install --frozen-lockfile` installerar låsta beroenden. GitHub Pages ska fortsätta fungera under installationen.

1. Autentisera Cloudflares officiella verktyg med `pnpm exec wrangler login` och kontrollera kontot med `pnpm exec wrangler whoami`. Ingen token ska kopieras till källkoden.
2. Skapa D1 med `pnpm exec wrangler d1 create lagbyggaren`. Lägg databasens ID i `wrangler.jsonc` (ID:t är inte en hemlighet). Platshållaren i filen måste ersättas; publicera inte med den.
3. Kör `pnpm exec wrangler d1 migrations apply lagbyggaren --remote`. Detta skapar bara tabellen; inga spelaruppgifter skrivs in.
4. Publicera Worker-koden med `pnpm exec wrangler deploy`. `/api/` vägrar åtkomst tills Access är konfigurerat och en giltig signerad identitet finns. Ingen första besökare kan ta över huvudtränarrollen.
5. Skydda hela Workerns `workers.dev`-adress med Cloudflare Access. Använd e-post med engångskod som inloggningsmetod. Välj aldrig en Bypass-policy. För att tränarna ska kunna läggas till inne i appen kan Access tillåta verifierad OTP-inloggning, medan appens egen lista avgör vilka verifierade e-postadresser som får data. Alternativt begränsar Access också exakta e-postadresser; då måste listorna hållas synkroniserade av huvudtränaren. Access Free har en användargräns som också gäller andra appar på kontot.
6. Ange `ACCESS_ISSUER` (exakt `https://<team>.cloudflareaccess.com`), `ACCESS_AUD` (Access-appens audience) och `OWNER_EMAIL` via `pnpm exec wrangler secret put <namn>`. `OWNER_NAME` är valfritt. Huvudtränarens e-post måste anges före första användningen.
7. Kontrollera två olika godkända konton, ett icke inbjudet konto, ett accepterat lag och återkallad åtkomst. Först därefter används Cloudflare-adressen som gruppens gemensamma app.

Cloudflare-konfigurationen publicerar bara sex uttryckligen valda webbappsfiler. `.data`, `.dev.vars`, `.env`, `.wrangler`, testdata och källfiler är inte statiska tillgångar. Förhandsvisningsadresser är avstängda. Sessionsidentitet verifieras med Cloudflares signerade JWT: rätt signatur, utfärdare, audience och giltighetstid krävs. En e-postheader ensam ger aldrig åtkomst. D1-bindningen nås endast från Workern. Inga CORS-undantag öppnar databasen för GitHub Pages.

## Flytta tidigare uppgifter

I GitHub-versionen, välj **Tränare → Säkerhetskopiera trupp och sparade lag**. I en tom Cloudflare-grupp visas **Flytta in trupp och historik** för huvudtränaren. Importen behåller spelar-ID:n och accepterad laghistorik. Historiken märks importerad; tidigare tränaråtkomst och röster förs inte över. Öppna förslag behöver nya röster. En redan använd grupp kan inte skrivas över med en historikimport.

## Teknik och samtidighet

D1 innehåller en versionskontrollerad rad med gruppens tillstånd. Alla uppdateringar använder atomisk `UPDATE ... WHERE version = ?`; en samtidig ändring ger 409 och hämtar den senaste versionen. Det gäller också inbjudningar, borttagen åtkomst och röster. Accepterade lag bevarar sina spelaruppgifter och beslutsdeltagare. Ingen automatisk återförsöksskrivning skapar dubbla förslag efter nätverksfel.

## Lokal utveckling och kontroller

- `node --test test.cjs cloudflare/test.mjs`: lagfördelning, historia, lokalt serverflöde, signerad Access-inloggning, nekad åtkomst, riktig SQLite med D1-anropskontrakt, samtidiga ändringar, röster, accepterade kopior och import.
- `pnpm exec wrangler deploy --dry-run`: bygger Worker och statiska tillgångar utan publicering.
- `pnpm run preview`: tidigare lokal Node-server, endast åtkomlig på datorn. Personliga testlänkar där används inte i Cloudflare-versionen.
- Direkt öppning av `index.html`: lokal webbläsarlagring.

Algoritmen är heuristisk: jämna truppstorlekar och unika spelare garanteras vid automatisk fördelning, men full positionstäckning, exakt målnivå och helt nya lagkamrater beror på truppen. Med ett lag och samma deltagare kan lagkamrater inte varieras.
