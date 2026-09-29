/* app.js — usa le funzioni pure di lib.js (caricato prima di questo file) */
(function () {
  "use strict";

  /* ---------- CONFIGURAZIONE ----------
     Open Library è la fonte di ricerca principale: è gratuita, senza chiave
     e senza limiti realistici per un uso personale.
     Google Books viene usato SOLO come riserva aggiuntiva (copre alcuni libri
     assenti da Open Library) e solo se qui sotto inserisci una tua chiave
     gratuita. Senza chiave, l'app funziona comunque perfettamente con la sola
     Open Library.

     Come ottenere una chiave gratuita (facoltativo):
     1. https://console.cloud.google.com/ → crea un progetto
     2. "API e servizi" → Libreria → cerca "Books API" → Abilita
     3. "Credenziali" → "Crea credenziali" → "Chiave API"
     4. (Consigliato) Limita la chiave: restrizioni API → solo Books API;
        restrizioni applicazione → referrer HTTP → il tuo dominio GitHub Pages
     5. Incolla la chiave qui sotto tra le virgolette. */
  const CONFIG = {
    GOOGLE_BOOKS_API_KEY: ""
  };

  const STORAGE_KEY = "libreria_libri_v1";
  const SORT_KEY_PREFIX = "libreria_sort_";

  /* ---------- STATO ---------- */
  let libri = caricaLibri();
  let schermataCorrente = "aggiungi";
  let ultimoRisultatoRicerca = []; // risultati grezzi dell'ultima ricerca (parsati)

  /* ---------- STORAGE ---------- */
  function caricaLibri() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error("Errore lettura storage:", e);
      return [];
    }
  }

  function salvaLibri() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(libri));
    } catch (e) {
      console.error("Errore salvataggio storage:", e);
      mostraToast("Impossibile salvare: memoria piena o non disponibile.");
    }
  }

  function getSort(schermata, def) {
    return localStorage.getItem(SORT_KEY_PREFIX + schermata) || def;
  }
  function setSort(schermata, valore) {
    localStorage.setItem(SORT_KEY_PREFIX + schermata, valore);
  }

  /* ---------- TOAST ---------- */
  let toastTimeout = null;
  function mostraToast(testo) {
    const el = document.getElementById("toast");
    el.textContent = testo;
    el.classList.remove("hidden");
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => el.classList.add("hidden"), 2200);
  }

  /* ---------- NAVIGAZIONE ---------- */
  const TITOLI_SCHERMATE = {
    aggiungi: "Aggiungi libro",
    daleggere: "Da leggere",
    letti: "Letti",
    impostazioni: "Altro"
  };

  function vaiA(schermata) {
    schermataCorrente = schermata;
    document.querySelectorAll(".screen").forEach((el) => el.classList.add("hidden"));
    document.getElementById("screen-" + schermata).classList.remove("hidden");
    document.querySelectorAll(".nav-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.screen === schermata);
    });
    document.getElementById("topbar-title").textContent = TITOLI_SCHERMATE[schermata];

    if (schermata === "daleggere") renderListaDaLeggere();
    if (schermata === "letti") renderListaLetti();
    if (schermata === "impostazioni") renderImpostazioni();
  }

  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => vaiA(btn.dataset.screen));
  });

  /* ---------- RICERCA ---------- */
  const form = document.getElementById("search-form");
  const statusEl = document.getElementById("search-status");
  const risultatiEl = document.getElementById("search-results");

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    eseguiRicerca();
  });

  async function eseguiRicerca() {
    const titolo = document.getElementById("input-titolo").value.trim();
    const autore = document.getElementById("input-autore").value.trim();
    const isbnInput = document.getElementById("input-isbn").value.trim();

    if (!titolo) {
      mostraToast("Il titolo è obbligatorio.");
      return;
    }
    if (isbnInput && !isbnValido(isbnInput)) {
      mostraToast("L'ISBN inserito non sembra valido (10 o 13 cifre).");
      return;
    }

    risultatiEl.innerHTML = "";
    statusEl.textContent = "Ricerca in corso…";
    ultimoRisultatoRicerca = [];

    try {
      const risultati = await cercaLibri({ titolo, autore, isbn: isbnInput });
      ultimoRisultatoRicerca = risultati;

      if (risultati.length === 0) {
        statusEl.textContent = "Nessun libro trovato. Prova a correggere titolo/autore/ISBN.";
        return;
      }

      statusEl.textContent = `${risultati.length} risultato/i trovato/i.`;
      renderRisultatiRicerca(risultati);
    } catch (err) {
      console.error(err);
      statusEl.textContent = "Errore di rete durante la ricerca. Controlla la connessione e riprova.";
    }
  }

  /* Punto d'ingresso unico per la ricerca: Open Library è la fonte primaria
     (nessuna chiave, nessun limite realistico). Google Books entra in gioco
     solo se è stata configurata una chiave API (CONFIG.GOOGLE_BOOKS_API_KEY)
     e solo per arricchire risultati scarsi o assenti — un suo eventuale
     errore/quota esaurita viene ignorato silenziosamente, senza far fallire
     la ricerca. */
  async function cercaLibri({ titolo, autore, isbn }) {
    if (isbn) {
      const daIsbn = await cercaSuOpenLibraryPerIsbn(isbn);
      if (daIsbn) return [daIsbn];
      if (CONFIG.GOOGLE_BOOKS_API_KEY) {
        const daGoogle = await provaGoogleBooksSenzaErrori({ titolo, autore, isbn });
        if (daGoogle.length > 0) return daGoogle;
      }
      return [];
    }

    const daOpenLibrary = await cercaSuOpenLibrarySearch({ titolo, autore });
    if (daOpenLibrary.length > 0) return daOpenLibrary;

    if (CONFIG.GOOGLE_BOOKS_API_KEY) {
      return await provaGoogleBooksSenzaErrori({ titolo, autore, isbn: "" });
    }
    return [];
  }

  async function provaGoogleBooksSenzaErrori(parametri) {
    try {
      return await cercaSuGoogleBooks(parametri);
    } catch (err) {
      console.warn("Google Books non disponibile, proseguo solo con Open Library:", err);
      return [];
    }
  }

  /* ---------- OPEN LIBRARY: ricerca per titolo/autore ---------- */
  /* Quattro tentativi, dal più preciso al più permissivo, ci si ferma al
     primo che dà risultati:
       1) campi title=/author=, solo edizioni italiane
       2) campi title=/author=, senza filtro lingua
       3) ricerca generale (q=), solo edizioni italiane — trova anche i
          titoli tradotti che Open Library indicizza come titolo alternativo
       4) ricerca generale (q=), senza filtro lingua
     Il passaggio 3/4 è il più utile quando si cerca un libro straniero
     usando solo il titolo italiano: Open Library ha spesso l'edizione
     italiana catalogata, ma la ricerca per campo "title" a volte la manca. */
  async function cercaSuOpenLibrarySearch({ titolo, autore }) {
    let risultati = await chiamaOpenLibrarySearch({ titolo, autore }, "ita", "campi");
    if (risultati.length > 0) return risultati;

    risultati = await chiamaOpenLibrarySearch({ titolo, autore }, null, "campi");
    if (risultati.length > 0) return risultati;

    risultati = await chiamaOpenLibrarySearch({ titolo, autore }, "ita", "generale");
    if (risultati.length > 0) return risultati;

    return await chiamaOpenLibrarySearch({ titolo, autore }, null, "generale");
  }

  async function chiamaOpenLibrarySearch({ titolo, autore }, lingua, modalita) {
    const query = new URLSearchParams();

    if (modalita === "generale") {
      const testo = costruisciQueryGeneraleOpenLibrary({ titolo, autore });
      if (!testo) return [];
      query.set("q", testo);
    } else {
      const parametri = costruisciParametriOpenLibrarySearch({ titolo, autore });
      if (Object.keys(parametri).length === 0) return [];
      Object.entries(parametri).forEach(([chiave, valore]) => query.set(chiave, valore));
    }

    query.set("limit", "12");
    query.set("fields", "key,title,author_name,isbn,cover_i,first_publish_year,subject,number_of_pages_median,language");
    if (lingua) query.set("language", lingua);

    const url = `https://openlibrary.org/search.json?${query.toString()}`;
    const risposta = await fetch(url);
    if (!risposta.ok) throw new Error("Open Library API error: " + risposta.status);
    const dati = await risposta.json();
    if (!dati.docs) return [];
    return dati.docs.map(parseOpenLibrarySearchDoc).filter((b) => b.title);
  }

  /* ---------- GOOGLE BOOKS (riserva opzionale, richiede una chiave) ---------- */
  async function cercaSuGoogleBooks({ titolo, autore, isbn }) {
    const query = costruisciQueryGoogleBooks({ titolo, autore, isbn });
    if (!query) return [];

    let risultati = await chiamaGoogleBooks(query, "it");
    if (risultati.length === 0) {
      risultati = await chiamaGoogleBooks(query, null);
    }
    return risultati;
  }

  async function chiamaGoogleBooks(query, langRestrict) {
    let url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=12&key=${encodeURIComponent(CONFIG.GOOGLE_BOOKS_API_KEY)}`;
    if (langRestrict) url += `&langRestrict=${langRestrict}`;
    const risposta = await fetch(url);
    if (!risposta.ok) throw new Error("Google Books API error: " + risposta.status);
    const dati = await risposta.json();
    if (!dati.items) return [];
    return dati.items.map(parseGoogleBookItem).filter((b) => b.title);
  }

  async function cercaSuOpenLibraryPerIsbn(isbn) {
    const isbnPulito = puliziaIsbn(isbn);
    const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${isbnPulito}&format=json&jscmd=data`;
    const risposta = await fetch(url);
    if (!risposta.ok) return null;
    const dati = await risposta.json();
    return parseOpenLibraryByIsbn(dati, isbnPulito);
  }

  function renderRisultatiRicerca(risultati) {
    risultatiEl.innerHTML = "";
    risultati.forEach((libro, indice) => {
      const card = creaCardLibro(libro, { mostraStato: false });
      card.addEventListener("click", () => apriModaleDettaglioRicerca(indice));
      risultatiEl.appendChild(card);
    });
  }

  /* ---------- CARD LIBRO (riutilizzata in ricerca e liste) ---------- */
  function creaCardLibro(libro, opzioni) {
    opzioni = opzioni || {};
    const card = document.createElement("div");
    card.className = "book-card";

    const cover = document.createElement("div");
    if (libro.thumbnail) {
      const img = document.createElement("img");
      img.src = libro.thumbnail;
      img.alt = "";
      img.className = "book-cover";
      img.loading = "lazy";
      img.onerror = () => { img.replaceWith(placeholderCopertina()); };
      cover.appendChild(img);
    } else {
      cover.appendChild(placeholderCopertina());
    }

    const info = document.createElement("div");
    info.className = "book-info";

    const titolo = document.createElement("p");
    titolo.className = "book-title";
    titolo.textContent = libro.title;
    info.appendChild(titolo);

    const autore = document.createElement("p");
    autore.className = "book-author";
    autore.textContent = libro.authors && libro.authors.length ? libro.authors.join(", ") : "Autore sconosciuto";
    info.appendChild(autore);

    const meta = document.createElement("p");
    meta.className = "book-meta";
    meta.textContent = formattaDataUscita(libro.publishedDate);
    info.appendChild(meta);

    if (opzioni.mostraVoto && libro.rating !== null && libro.rating !== undefined) {
      const starsWrap = document.createElement("div");
      starsWrap.className = "book-stars";
      starsWrap.appendChild(creaStelleReadonly(libro.rating, "small"));
      info.appendChild(starsWrap);
    }

    card.appendChild(cover.firstChild);
    card.appendChild(info);
    return card;
  }

  function placeholderCopertina() {
    const div = document.createElement("div");
    div.className = "book-cover";
    div.textContent = "📕";
    return div;
  }

  /* ---------- STELLE ---------- */
  function creaStelleInterattive(valoreIniziale, onChange) {
    const wrap = document.createElement("div");
    wrap.className = "star-rating";
    aggiornaStelleDOM(wrap, valoreIniziale || 0);

    wrap.addEventListener("click", (e) => {
      const starEl = e.target.closest(".star");
      if (!starEl) return;
      const indice = parseInt(starEl.dataset.index, 10);
      const rect = starEl.getBoundingClientRect();
      const cliccatoASinistra = (e.clientX - rect.left) < rect.width / 2;
      const nuovoValore = arrotondaVoto(indice + (cliccatoASinistra ? 0.5 : 1));
      aggiornaStelleDOM(wrap, nuovoValore);
      onChange(nuovoValore);
    });

    return wrap;
  }

  function creaStelleReadonly(valore, dimensione) {
    const wrap = document.createElement("div");
    wrap.className = "star-rating readonly" + (dimensione === "small" ? " small" : "");
    aggiornaStelleDOM(wrap, valore || 0);
    return wrap;
  }

  function aggiornaStelleDOM(wrap, valore) {
    wrap.innerHTML = "";
    for (let i = 0; i < 5; i++) {
      const star = document.createElement("span");
      star.className = "star";
      star.dataset.index = String(i);
      star.textContent = "☆";

      const riempimento = Math.max(0, Math.min(1, valore - i)); // 0, 0.5 o 1
      if (riempimento > 0) {
        const fill = document.createElement("span");
        fill.className = "star-fill";
        fill.style.width = (riempimento * 100) + "%";
        fill.textContent = "★";
        star.appendChild(fill);
      }
      wrap.appendChild(star);
    }
  }

  /* ---------- MODALE ---------- */
  const overlay = document.getElementById("modal-overlay");
  const modalContent = document.getElementById("modal-content");

  function chiudiModale() {
    overlay.classList.add("hidden");
    modalContent.innerHTML = "";
  }
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) chiudiModale();
  });

  function apriModale(contenutoEl) {
    modalContent.innerHTML = "";
    modalContent.appendChild(contenutoEl);
    overlay.classList.remove("hidden");
  }

  // --- Dettaglio da un risultato di ricerca (libro non ancora salvato) ---
  function apriModaleDettaglioRicerca(indice) {
    const libro = ultimoRisultatoRicerca[indice];
    const contenuto = costruisciCorpoModale(libro, { modalitaRicerca: true });

    const azioni = document.createElement("div");
    azioni.className = "modal-actions";

    const giaSalvato = trovaLibroEsistente(libro);
    if (giaSalvato) {
      const avviso = document.createElement("p");
      avviso.style.color = "var(--text-dim)";
      avviso.style.fontSize = "0.85rem";
      avviso.textContent = giaSalvato.status === "letto"
        ? "Hai già segnato questo libro come letto."
        : "Questo libro è già nella tua lista \"Da leggere\".";
      azioni.appendChild(avviso);
    } else {
      const btnSalva = document.createElement("button");
      btnSalva.className = "btn btn-primary";
      btnSalva.textContent = "Salva per dopo";
      btnSalva.addEventListener("click", () => {
        salvaNuovoLibro(libro, "daLeggere");
        mostraToast("Aggiunto a \"Da leggere\".");
        chiudiModale();
      });
      azioni.appendChild(btnSalva);

      const btnLetto = document.createElement("button");
      btnLetto.className = "btn btn-secondary";
      btnLetto.textContent = "Segna subito come letto";
      btnLetto.addEventListener("click", () => {
        const nuovo = salvaNuovoLibro(libro, "letto");
        chiudiModale();
        apriModaleValutazione(nuovo.id);
      });
      azioni.appendChild(btnLetto);
    }

    contenuto.appendChild(azioni);
    apriModale(contenuto);
  }

  // --- Dettaglio di un libro già salvato ---
  function apriModaleDettaglioSalvato(id) {
    const libro = libri.find((l) => l.id === id);
    if (!libro) return;
    const contenuto = costruisciCorpoModale(libro, { modalitaRicerca: false });

    const azioni = document.createElement("div");
    azioni.className = "modal-actions";

    if (libro.status === "daLeggere") {
      const riga = document.createElement("div");
      riga.className = "modal-actions-row";

      const btnLetto = document.createElement("button");
      btnLetto.className = "btn btn-primary";
      btnLetto.textContent = "Segna come letto";
      btnLetto.addEventListener("click", () => {
        chiudiModale();
        apriModaleValutazione(libro.id);
      });
      riga.appendChild(btnLetto);
      azioni.appendChild(riga);

      const btnRimuovi = document.createElement("button");
      btnRimuovi.className = "btn btn-secondary";
      btnRimuovi.textContent = "Rimuovi dalla libreria";
      btnRimuovi.addEventListener("click", () => rimuoviConConferma(libro.id));
      azioni.appendChild(btnRimuovi);
    } else {
      // Libro già letto: mostra voto/recensione e permette la modifica
      const sezioneVoto = document.createElement("div");
      sezioneVoto.className = "modal-section";
      const h3 = document.createElement("h3");
      h3.textContent = "Il tuo voto";
      sezioneVoto.appendChild(h3);

      let votoCorrente = libro.rating;
      const stelle = creaStelleInterattive(votoCorrente, (nuovoValore) => {
        votoCorrente = nuovoValore;
      });
      sezioneVoto.appendChild(stelle);
      contenuto.appendChild(sezioneVoto);

      const sezioneRecensione = document.createElement("div");
      sezioneRecensione.className = "modal-section";
      const h3r = document.createElement("h3");
      h3r.textContent = "La tua recensione";
      sezioneRecensione.appendChild(h3r);
      const textarea = document.createElement("textarea");
      textarea.className = "review-input";
      textarea.placeholder = "Scrivi cosa ne pensi (facoltativo)…";
      textarea.value = libro.review || "";
      sezioneRecensione.appendChild(textarea);
      contenuto.appendChild(sezioneRecensione);

      if (libro.dataLettura) {
        const dataLettura = document.createElement("p");
        dataLettura.className = "book-meta";
        dataLettura.textContent = "Letto il " + formattaDataItaliana(libro.dataLettura);
        contenuto.appendChild(dataLettura);
      }

      const btnSalvaVoto = document.createElement("button");
      btnSalvaVoto.className = "btn btn-primary";
      btnSalvaVoto.textContent = "Salva voto e recensione";
      btnSalvaVoto.addEventListener("click", () => {
        libro.rating = votoCorrente;
        libro.review = textarea.value.trim();
        salvaLibri();
        mostraToast("Salvato.");
        chiudiModale();
        renderListaLetti();
      });
      azioni.appendChild(btnSalvaVoto);

      const btnRiportaDaLeggere = document.createElement("button");
      btnRiportaDaLeggere.className = "btn btn-secondary";
      btnRiportaDaLeggere.textContent = "Sposta di nuovo in \"Da leggere\"";
      btnRiportaDaLeggere.addEventListener("click", () => {
        libro.status = "daLeggere";
        libro.dataLettura = null;
        salvaLibri();
        chiudiModale();
        mostraToast("Spostato in \"Da leggere\".");
        renderListaDaLeggere();
        renderListaLetti();
      });
      azioni.appendChild(btnRiportaDaLeggere);

      const btnRimuovi = document.createElement("button");
      btnRimuovi.className = "btn btn-danger";
      btnRimuovi.textContent = "Rimuovi dalla libreria";
      btnRimuovi.addEventListener("click", () => rimuoviConConferma(libro.id));
      azioni.appendChild(btnRimuovi);
    }

    contenuto.appendChild(azioni);
    apriModale(contenuto);
  }

  // --- Piccolo modale dedicato al primo voto quando si segna "letto" ---
  function apriModaleValutazione(id) {
    const libro = libri.find((l) => l.id === id);
    if (!libro) return;

    const contenuto = document.createElement("div");
    const titolo = document.createElement("h2");
    titolo.className = "modal-title";
    titolo.textContent = "Come valuti \"" + libro.title + "\"?";
    contenuto.appendChild(titolo);

    const sezioneVoto = document.createElement("div");
    sezioneVoto.className = "modal-section";
    let votoCorrente = 0;
    const stelle = creaStelleInterattive(0, (v) => { votoCorrente = v; });
    sezioneVoto.appendChild(stelle);
    contenuto.appendChild(sezioneVoto);

    const textarea = document.createElement("textarea");
    textarea.className = "review-input";
    textarea.placeholder = "Recensione (facoltativa)…";
    contenuto.appendChild(textarea);

    const azioni = document.createElement("div");
    azioni.className = "modal-actions";
    const btnConferma = document.createElement("button");
    btnConferma.className = "btn btn-primary";
    btnConferma.textContent = "Fatto";
    btnConferma.addEventListener("click", () => {
      libro.status = "letto";
      if (!libro.dataLettura) libro.dataLettura = new Date().toISOString();
      libro.rating = votoCorrente || null;
      libro.review = textarea.value.trim();
      salvaLibri();
      chiudiModale();
      mostraToast("Segnato come letto.");
      renderListaDaLeggere();
      renderListaLetti();
    });
    azioni.appendChild(btnConferma);
    contenuto.appendChild(azioni);

    apriModale(contenuto);
  }

  function costruisciCorpoModale(libro, opzioni) {
    const contenuto = document.createElement("div");

    const header = document.createElement("div");
    header.className = "modal-header";

    if (libro.thumbnail) {
      const img = document.createElement("img");
      img.src = libro.thumbnail;
      img.className = "modal-cover";
      img.alt = "";
      img.onerror = () => { img.style.display = "none"; };
      header.appendChild(img);
    }

    const testata = document.createElement("div");
    const titolo = document.createElement("h2");
    titolo.className = "modal-title";
    titolo.textContent = libro.title;
    testata.appendChild(titolo);

    const autore = document.createElement("p");
    autore.className = "modal-author";
    autore.textContent = libro.authors && libro.authors.length ? libro.authors.join(", ") : "Autore sconosciuto";
    testata.appendChild(autore);

    const metaList = document.createElement("div");
    metaList.className = "modal-meta-list";
    const righeMeta = [];
    righeMeta.push("Genere: " + generePerVisualizzazione(libro.categories));
    righeMeta.push("Uscita: " + formattaDataUscita(libro.publishedDate));
    if (libro.pageCount) righeMeta.push("Pagine: " + libro.pageCount);
    if (libro.isbn) righeMeta.push("ISBN: " + libro.isbn);
    metaList.innerHTML = righeMeta.join("<br>");
    testata.appendChild(metaList);

    header.appendChild(testata);
    contenuto.appendChild(header);

    const sezioneDescrizione = document.createElement("div");
    sezioneDescrizione.className = "modal-section";
    const h3 = document.createElement("h3");
    h3.textContent = "Riassunto";
    sezioneDescrizione.appendChild(h3);
    const p = document.createElement("p");
    if (libro.description) {
      p.textContent = ripulisciDescrizione(libro.description);
    } else if (libro.workKey) {
      p.textContent = "Caricamento riassunto…";
      caricaDescrizioneLazy(libro, p);
    } else {
      p.textContent = "Nessun riassunto disponibile per questa edizione.";
    }
    sezioneDescrizione.appendChild(p);
    contenuto.appendChild(sezioneDescrizione);

    if (!opzioni.modalitaRicerca && libro.status === "letto" && libro.review) {
      // La recensione salvata viene comunque mostrata/editata più sotto dal chiamante
    }

    return contenuto;
  }

  function ripulisciDescrizione(html) {
    // Le descrizioni di Google Books a volte contengono tag HTML semplici (<p>, <b>, <br>).
    const div = document.createElement("div");
    div.innerHTML = html;
    return div.textContent || div.innerText || "";
  }

  /* Open Library non include il riassunto nell'endpoint di ricerca:
     va richiesto separatamente sull'oggetto "work" solo quando serve
     davvero (apertura del dettaglio), e viene tenuto in cache sull'oggetto
     libro (e su storage, se il libro è già salvato) per non richiederlo di nuovo. */
  async function caricaDescrizioneLazy(libro, pElement) {
    try {
      const risposta = await fetch(`https://openlibrary.org${libro.workKey}.json`);
      if (!risposta.ok) throw new Error("Open Library work API error: " + risposta.status);
      const dati = await risposta.json();
      const testo = estraiDescrizioneOpenLibraryWork(dati);
      libro.description = testo || "";
      if (testo) {
        pElement.textContent = ripulisciDescrizione(testo);
        if (libro.id) salvaLibri(); // il libro è già in libreria: persiste il riassunto trovato
      } else {
        pElement.textContent = "Nessun riassunto disponibile per questa edizione.";
      }
    } catch (err) {
      console.warn("Impossibile caricare il riassunto:", err);
      pElement.textContent = "Nessun riassunto disponibile per questa edizione.";
    }
  }

  /* ---------- SALVATAGGIO / RIMOZIONE LIBRI ---------- */
  function trovaLibroEsistente(libroRicerca) {
    const chiave = idLibro(libroRicerca);
    return libri.find((l) => idLibro(l) === chiave);
  }

  function salvaNuovoLibro(libroRicerca, status) {
    const esistente = trovaLibroEsistente(libroRicerca);
    if (esistente) return esistente;

    const nuovo = Object.assign({}, libroRicerca, {
      id: idLibro(libroRicerca) + ":" + Date.now(),
      status: status,
      rating: null,
      review: "",
      dataAggiunta: new Date().toISOString(),
      dataLettura: status === "letto" ? new Date().toISOString() : null
    });
    libri.push(nuovo);
    salvaLibri();
    return nuovo;
  }

  function rimuoviConConferma(id) {
    const libro = libri.find((l) => l.id === id);
    if (!libro) return;
    const ok = window.confirm(`Rimuovere "${libro.title}" dalla libreria? L'azione non è reversibile.`);
    if (!ok) return;
    libri = libri.filter((l) => l.id !== id);
    salvaLibri();
    chiudiModale();
    mostraToast("Rimosso.");
    renderListaDaLeggere();
    renderListaLetti();
  }

  /* ---------- RENDER LISTE ---------- */
  function renderListaDaLeggere() {
    const lista = libri.filter((l) => l.status === "daLeggere");
    const contenitore = document.getElementById("list-daleggere");
    const vuoto = document.getElementById("empty-daleggere");
    const criterio = getSort("daleggere", "dataAggiunta");

    aggiornaSortBar("daleggere", criterio);

    if (lista.length === 0) {
      contenitore.innerHTML = "";
      vuoto.classList.remove("hidden");
      return;
    }
    vuoto.classList.add("hidden");

    const righe = ordinaLibri(lista, criterio);
    renderRigheLista(contenitore, righe, apriModaleDettaglioSalvato);
  }

  function renderListaLetti() {
    const lista = libri.filter((l) => l.status === "letto");
    const contenitore = document.getElementById("list-letti");
    const vuoto = document.getElementById("empty-letti");
    const criterio = getSort("letti", "dataLettura");

    aggiornaSortBar("letti", criterio);

    if (lista.length === 0) {
      contenitore.innerHTML = "";
      vuoto.classList.remove("hidden");
      return;
    }
    vuoto.classList.add("hidden");

    const righe = ordinaLibri(lista, criterio);
    renderRigheLista(contenitore, righe, apriModaleDettaglioSalvato, true);
  }

  function renderRigheLista(contenitore, righe, onClickLibro, mostraVoto) {
    contenitore.innerHTML = "";
    righe.forEach((riga) => {
      if (riga.tipo === "header") {
        const h = document.createElement("div");
        h.className = "genre-group-header";
        h.textContent = riga.testo;
        contenitore.appendChild(h);
      } else {
        const card = creaCardLibro(riga.libro, { mostraVoto: !!mostraVoto });
        card.addEventListener("click", () => onClickLibro(riga.libro.id));
        contenitore.appendChild(card);
      }
    });
  }

  function aggiornaSortBar(schermata, criterioAttivo) {
    const bar = document.querySelector(`.sort-bar[data-for="${schermata}"]`);
    bar.querySelectorAll(".sort-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.sort === criterioAttivo);
    });
  }

  document.querySelectorAll(".sort-bar").forEach((bar) => {
    bar.addEventListener("click", (e) => {
      const btn = e.target.closest(".sort-btn");
      if (!btn) return;
      const schermata = bar.dataset.for;
      setSort(schermata, btn.dataset.sort);
      if (schermata === "daleggere") renderListaDaLeggere();
      if (schermata === "letti") renderListaLetti();
    });
  });

  /* ---------- IMPOSTAZIONI / BACKUP ---------- */
  function renderImpostazioni() {
    const totali = libri.length;
    const letti = libri.filter((l) => l.status === "letto").length;
    const daLeggere = totali - letti;
    const votati = libri.filter((l) => l.status === "letto" && l.rating !== null && l.rating !== undefined);
    const mediaVoto = votati.length
      ? (votati.reduce((s, l) => s + l.rating, 0) / votati.length).toFixed(1)
      : "—";

    document.getElementById("stats-text").innerHTML =
      `Totale libri: <strong>${totali}</strong><br>` +
      `Da leggere: <strong>${daLeggere}</strong> · Letti: <strong>${letti}</strong><br>` +
      `Voto medio dato: <strong>${mediaVoto}</strong>`;
  }

  document.getElementById("btn-export").addEventListener("click", () => {
    const dati = JSON.stringify(libri, null, 2);
    const blob = new Blob([dati], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const oggi = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `backup-libreria-${oggi}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });

  document.getElementById("input-import").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const importati = JSON.parse(reader.result);
        if (!Array.isArray(importati)) throw new Error("Formato non valido");
        const validi = importati.filter((l) => l && l.id && l.title);
        if (validi.length === 0) throw new Error("Nessun libro valido nel file");

        const idEsistenti = new Set(libri.map((l) => l.id));
        let aggiunti = 0;
        validi.forEach((l) => {
          if (!idEsistenti.has(l.id)) {
            libri.push(l);
            idEsistenti.add(l.id);
            aggiunti++;
          }
        });
        salvaLibri();
        mostraToast(`Importati ${aggiunti} nuovi libri.`);
        renderImpostazioni();
        renderListaDaLeggere();
        renderListaLetti();
      } catch (err) {
        console.error(err);
        mostraToast("File di backup non valido.");
      } finally {
        e.target.value = "";
      }
    };
    reader.readAsText(file);
  });

  document.getElementById("btn-reset").addEventListener("click", () => {
    const ok = window.confirm("Cancellare TUTTI i libri salvati? Esporta un backup prima, se non l'hai già fatto.");
    if (!ok) return;
    const okDoppio = window.confirm("Sei sicuro? Questa azione non può essere annullata.");
    if (!okDoppio) return;
    libri = [];
    salvaLibri();
    mostraToast("Libreria svuotata.");
    renderImpostazioni();
    renderListaDaLeggere();
    renderListaLetti();
  });

  /* ---------- SERVICE WORKER ---------- */
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch((err) => {
        console.warn("Registrazione service worker fallita:", err);
      });
    });
  }

  /* ---------- AVVIO ---------- */
  vaiA("aggiungi");
})();
