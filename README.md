# Lagbyggaren

Fristående handbollsapp för trupp, jämna eller nivåanpassade lag och gemensam granskning. HK Ankarets utseende, nivå 1–3 i halvsteg, 1–3 lag, 6+1 eller 4+1. Historik påverkar valet av lagkamrater.

## Gemensam Cloudflare-version

Cloudflare Pages med Functions på Workers Free och D1 Free används. Zero Trust behövs inte: `AUTH_MODE=links` ger personliga tränarlänkar utan konto eller e-postkod. Alla med en giltig tränarlänk kan läsa och redigera truppen, inklusive nivåerna. Länkarna ska hållas inom tränargruppen. En länk identifierar tränaren vid omröstning men verifierar inte personens identitet.

Huvudtränaren skapar en personlig länk för varje kollega under Tränare. Där kan åtkomst också återkallas. Alla inbjudna tränare måste godkänna den aktuella versionen före acceptans. En revidering nollställer rösterna; accepterade lag behåller sina ursprungliga spelaruppgifter.

GitHub Pages fungerar fortfarande med lokal webbläsarlagring. GitHub innehåller bara kod; aldrig spelardata eller tränarlänkar.

## Publicering

Node 24 och pnpm används. Installera med `pnpm install --frozen-lockfile`. Cloudflare Pages använder den befintliga GitHub-kopplingen med byggkommandot `node scripts/build-pages.mjs` och utdatakatalog `.worker-assets`. Ingen separat byggnyckel krävs. Byggen från andra grenar ska vara avstängda. Preview-miljön saknar databasbindning. Kontot ska förbli Workers Free; ingen betald plan behövs.

D1-bindningen finns i wrangler.jsonc. Skapa tabellen med migrations/0001_workspace.sql innan första användningen. Ange OWNER_EMAIL och valfritt OWNER_NAME som Cloudflare-inställningar. Skapa 32 kryptografiskt slumpmässiga byte som hexadecimal ägarnyckel. Lägg endast dess SHA-256-hash i Cloudflare som OWNER_TOKEN_HASH. Huvudtränarens länk är appens adress med `/#key=<ägarnyckel>`. Spara aldrig nyckeln i GitHub. Appen tar bort nyckeln från adressfältet efter öppning och sparar den i webbläsaren.

Databasen lagrar endast hashvärden för åtkomstnycklar. API-svar innehåller inte hashlistan. Saknade eller ogiltiga nycklar nekas, och huvudtränarens nyckel krävs för att initiera en tom databas. Ändringar från främmande webbplatser nekas. Atomiska versionskontroller hindrar samtidiga ändringar från att skriva över varandra.

Access-koden finns kvar som ett alternativ för framtiden, men används inte när AUTH_MODE är links. Byte av autentiseringsmetod för en befintlig grupp kräver planerad migrering av tränarnas åtkomst.

## Flytta tidigare uppgifter

I GitHub-versionen väljer huvudtränaren Tränare → Säkerhetskopiera trupp och sparade lag. I en tom gemensam grupp finns Flytta in trupp och historik. Importen bevarar spelar-ID:n och accepterade lag. Tidigare röster och tränaråtkomst förs inte över. Befintliga uppgifter kan inte skrivas över av historikimporten.

## Gratisnivå och kontroller

Synkronisering sker var 30:e sekund och pausas i dolda flikar eller efter fem minuters inaktivitet. Lagberäkning görs i webbläsaren. Appen har gränser på 20 tränare, 200 spelare och 750 000 byte sparat innehåll. Ingen automatisk uppgradering eller radering av historik görs.

Kontogränser gäller även andra appar på samma konto. Se https://developers.cloudflare.com/workers/platform/pricing/ och https://developers.cloudflare.com/d1/platform/pricing/.

Kör `node --test test.cjs cloudflare/test.mjs` för lagfördelning, historik, samtidighet, inbjudningar, nekad och återkallad åtkomst, röster och import. `node scripts/build-pages.mjs` kontrollerar publiceringsbygget. `pnpm run preview` startar den tidigare lokala servern.

Algoritmen är heuristisk: full positionstäckning, exakt målnivå och nya lagkamrater beror på tillgänglig trupp.
