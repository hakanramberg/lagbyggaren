# Lagbyggaren

Lagbyggaren följer Sommarjaktens röda HK Ankaret-tema och fungerar för träningar, matcher och turneringar.

## Användning

1. Lägg till spelare med första-/andraposition och utvecklingsnivå 1–3 i steg om 0,5. Lägre tal betyder högre utvecklingsnivå.
2. Välj deltagare, namn och typ av tillfälle, 1–3 lag, spelform 6+1 eller 4+1, samt jämnstarka eller nivåanpassade lag.
3. Skapa ett förslag. Flytta spelare mellan lagen vid behov. Luckor i positionstäckningen visas.
4. Spara för granskning. Tränarna godkänner eller begär justering med kommentar. Varje tränare har en röst som kan ändras.
5. Alla för närvarande inbjudna tränare måste godkänna den aktuella versionen innan någon kan välja **Spara accepterade lag**. Ändras ett förslag nollställs rösterna. En sparad uppställning är låst; välj **Använd som nytt utkast** för att utgå från den igen.

Spelarnas stabila ID:n följer med i export/import och behålls vid namnändring. Accepterade lag sparar en separat kopia av spelarnas uppgifter och vilka tränare som deltog i beslutet. Historiken ändras inte när spelare ändras eller tas bort.

## Gemensam lagring och åtkomst

Webbversionen sparar gemensamt på servern: trupp, förslag, versionsnummer, röster och accepterade lag. Tränarna ser uppdateringar inom ungefär tio sekunder. Samtidiga skrivningar versionskontrolleras; äldre ändringar får inte skriva över nyare utan att användaren försöker igen. Deltagarval och osparade utkast är privata för den öppna sidan.

Huvudtränaren skapar en personlig inbjudningslänk för varje kollega under **Tränare**. Varje länk är en åtkomstnyckel och identifierar en tränare. Det är inte e-postverifiering eller SSO. Alla tränare kan redigera truppen och förslagen; endast huvudtränaren kan bjuda in och återkalla åtkomst. Nycklar lagras som SHA-256-hashar på servern. Nyckeln i en inbjudningslänk flyttas från URL-fragmentet till webbläsarens lokala lagring vid inloggning. Utloggning tar bort den lokala nyckeln. Återkallad åtkomst gäller omedelbart på servern.

## Lokal förhandsvisning

Med Node 24 installerat, kör `npm run preview` i denna mapp. Öppna länken i `.data/preview-url.txt`. Tjänsten lyssnar bara på den egna datorn. Den länken fungerar inte från kollegornas hem. Ingen molntjänst startas av detta kommando.

Om `index.html` öppnas direkt som fil används en tydligt märkt lokal förhandsvisning utan delning. Tidigare spelarregister migreras automatiskt och deras ID:n bevaras. Lokal filversion och serverversion har olika lagring: exportera/importera truppen för att flytta den. Export av spelare innehåller ingen historik. Säkerhetskopian under Tränare innehåller hela gruppens data utan åtkomstnycklar.

## Internetpublicering på Render – förberett, inte driftsatt

`render.yaml` definierar en webbtjänst i Frankfurt med en beständig disk. Tjänsten och disken är avgiftsbelagda. Läs det aktuella kostnadsförslaget i Render innan du godkänner skapandet. Det finns inget aktivt abonnemang eller publicerad internetadress skapad av detta projekt.

1. Lägg appkoden i ett privat Git-repository. `.data`, `.test-data*` och åtkomstnycklar ska inte följa med.
2. I ditt Render-konto, skapa en Blueprint från repositoryt och ange Blueprint-sökväg `render.yaml`.
3. Kontrollera region, beständig disk och kostnad. Anpassa `OWNER_NAME` före första starten. Render genererar `OWNER_TOKEN`; behåll den som hemlighet.
4. Efter publicering, öppna tjänstens HTTPS-adress och ange `OWNER_TOKEN` från tjänstens miljöinställningar i appens inloggningsformulär. Bjud sedan in kollegorna med personliga länkar.
5. Importera spelartruppen från den lokala appen. Testa en inbjudan, två tränarröster, ett accepterat förslag och en omstart innan gruppen börjar använda tjänsten.

Servern använder en atomiskt skriven och flushad JSON-fil under `DATA_DIR`. Kör exakt en serverinstans med beständig disk. Render-konfigurationen monterar `/var/data`; vanlig tillfällig lagring får inte användas. Webbadress och HTTPS hanteras av Render. Inga anrop görs till Sommarjaktens befintliga Google Apps Script-tjänst.

Fullständig återställning vid drift sker från en säkerhetskopia av `DATA_DIR/workspace.json` medan tjänsten är stoppad; den innehåller även nyckelhashar. Spara den separat från koden. Render har också disksnapshots. UI-exporten är en läsbar datakopia utan autentiseringsuppgifter och har ännu ingen egen återställningsknapp. En ändrad `OWNER_TOKEN` ändrar inte automatiskt en redan skapad huvudtränares nyckel; den används bara vid första start.

Officiella driftreferenser: https://render.com/docs/disks och https://render.com/docs/blueprint-spec. Aktuellt pris: https://render.com/pricing.

## Hur historiken påverkar lagförslagen

De tio senast accepterade tillfällena, efter tidpunkten då de accepterades, räknas. Spelarpar som nyligen varit i samma lag får en högre kostnad i sökningen, med avtagande vikt från 1,0 till 0,1. Lagnummer spelar ingen roll: att bara byta lagnamn ger ingen förbättring. Avbytare ingår i laggemenskapen och snittnivån. Oaccepterade förslag påverkar inte historiken.

Positionstäckning, målnivå och varierade lagkamrater vägs samman. Truppstorlekarna skiljer högst en spelare vid automatisk fördelning. Sökningen är heuristisk och garanterar inte ett globalt optimum eller helt nya lag varje gång. Med ett lag och samma deltagare går det inte att byta lagkamrater. Manuella flyttar kan ge ojämna truppstorlekar.

## Kontroller

`npm test` testar fördelning, målnivå, variation med historik, unika spelare, behörigheter, versionskonflikter, röster, accepterande, låst historik och beständighet efter omstart.

`verify.cjs` testar två separata webbläsarsessioner från inbjudan till accepterat lag, nya versioner, mobilvy och migration av gamla spelare. Det använder den här datorns Playwright-installation och Edge. Testdata skrivs till ignorerade `.test-data-*`-mappar, separat från riktiga uppgifter.

## GitHub Pages

Appens statiska version publiceras under /lagbyggaren/ i det egna repositoryt hakanramberg/lagbyggaren. config.js anger lokal webbläsarlagring, så ingen saknad serverinloggning blockerar appen. Spelare, granskning av den egna tränaren och accepterade lag fungerar lokalt. Delning av webbadressen innebär inte delad data. Node-servern levererar en egen config.js som aktiverar gemensam lagring när serverversionen används. Personuppgifter och åtkomstnycklar ska aldrig läggas i det publika repositoryt.

Eget repository: https://github.com/hakanramberg/lagbyggaren
Webbapp: https://hakanramberg.github.io/lagbyggaren/
