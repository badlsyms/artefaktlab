# Soukromý přístup a mobilní prostředí Nucleusu

Chybějící nebo prázdný `NUCLEUS_ACCESS_PIN` nově znamená HTTP 503 `ACCESS_NOT_CONFIGURED` pro operace chráněné PINem, nikoliv veřejný přístup. Nesprávný PIN vrací 401. Změna se týká stávajících chráněných chat/fact-check/vault/hound/cloud tras; veřejné health, status a news feed zůstávají veřejné. Stav konfigurace je viditelný v rozhraní, hodnota PINu se nevypisuje.

Před nasazením musí být na cílové službě nastaven existující PIN, ideálně vazbou na tajemství. Pokud není nastaven, služba je záměrně zamčená; doplnění konfigurace nevyžaduje úpravu zdrojů. Tento PR neprovádí nasazení ani změny cloudových oprávnění.

Rozhraní přidává světlý/tmavý režim s uložením volby, systémové okraje, zalamování mobilní hlavičky, bezpečnější šířku kalendáře a čitelnější aktivní záložky. Offline cache obsahuje nové styly a přepínač motivu.

Kontroly: `npm run check`, `npm test`. Browser workflow pokrývá 320/360/393/412px, landscape i desktop, oba motivy a text 200 %. Nemůže nahradit test systémové klávesnice a výřezu na fyzickém telefonu.
