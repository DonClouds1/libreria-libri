/* lib.js
   Funzioni pure, senza dipendenze dal DOM.
   Caricato sia nel browser (window) sia in Node (per i test) tramite
   il piccolo export condizionale in fondo al file. */

/* ---------- GENERI: mappa inglese -> italiano ---------- */
/* Google Books restituisce categorie quasi sempre in inglese, spesso nel
   formato "Fiction / Fantasy / Epic". Prendiamo il primo segmento della
   prima categoria e lo traduciamo se lo conosciamo. */
const MAPPA_GENERI = {
  "fiction": "Narrativa",
  "juvenile fiction": "Narrativa per ragazzi",
  "young adult fiction": "Narrativa Young Adult",
  "young adult nonfiction": "Saggistica Young Adult",
  "biography & autobiography": "Biografia",
  "history": "Storia",
  "science": "Scienza",
  "science fiction": "Fantascienza",
  "fantasy": "Fantasy",
  "horror": "Horror",
  "mystery": "Giallo",
  "detective and mystery stories": "Giallo",
  "thrillers": "Thriller",
  "romance": "Romance",
  "poetry": "Poesia",
  "drama": "Teatro",
  "comics & graphic novels": "Fumetti",
  "business & economics": "Economia e Business",
  "self-help": "Auto-aiuto",
  "psychology": "Psicologia",
  "philosophy": "Filosofia",
  "religion": "Religione",
  "cooking": "Cucina",
  "art": "Arte",
  "travel": "Viaggi",
  "true crime": "True Crime",
  "health & fitness": "Salute e Benessere",
  "education": "Educazione",
  "computers": "Informatica",
  "technology & engineering": "Tecnologia e Ingegneria",
  "reference": "Consultazione",
  "social science": "Scienze Sociali",
  "political science": "Scienze Politiche",
  "law": "Diritto",
  "medical": "Medicina",
  "language arts & disciplines": "Linguistica",
  "literary criticism": "Critica Letteraria",
  "music": "Musica",
  "nature": "Natura",
  "sports & recreation": "Sport",
  "juvenile nonfiction": "Saggistica per ragazzi",
  "body, mind & spirit": "Corpo, Mente e Spirito",
  "family & relationships": "Famiglia e Relazioni",
  "literary collections": "Antologie",
  "study aids": "Materiale di studio",
  // Aggiuntivi: "subject" di Open Library, spesso diversi da quelli di Google Books
  "biography": "Biografia",
  "historical fiction": "Narrativa storica",
  "adventure stories": "Avventura",
  "adventure fiction": "Avventura",
  "love stories": "Romance",
  "war stories": "Guerra",
  "american fiction": "Narrativa",
  "english fiction": "Narrativa",
  "children's fiction": "Narrativa per ragazzi",
  "children's stories": "Narrativa per ragazzi",
  "picture books": "Libri illustrati",
  "graphic novels": "Fumetti",
  "short stories": "Racconti",
  "essays": "Saggistica",
  "detective and mystery stories, english": "Giallo",
  "fantasy fiction": "Fantasy",
  "science fiction, american": "Fantascienza"
};

/* Fallback "morbido": se la categoria non è una chiave esatta della mappa
   sopra, cerchiamo comunque una parola chiave nota al suo interno.
   Serve soprattutto per Open Library, i cui "subject" sono testo libero
   (es. "Fantasy fiction, Bilbo Baggins (Fictional character)"). */
const PAROLE_CHIAVE_GENERE = [
  { parole: ["fantasy"], nome: "Fantasy" },
  { parole: ["science fiction", "sci-fi"], nome: "Fantascienza" },
  { parole: ["detective", "mystery"], nome: "Giallo" },
  { parole: ["thriller"], nome: "Thriller" },
  { parole: ["romance", "love stor"], nome: "Romance" },
  { parole: ["horror"], nome: "Horror" },
  { parole: ["biography", "autobiograph"], nome: "Biografia" },
  { parole: ["poetry"], nome: "Poesia" },
  { parole: ["histor"], nome: "Storia" },
  { parole: ["juvenile", "children"], nome: "Narrativa per ragazzi" },
  { parole: ["comic", "graphic novel"], nome: "Fumetti" },
  { parole: ["cook"], nome: "Cucina" },
  { parole: ["travel"], nome: "Viaggi" },
  { parole: ["philosoph"], nome: "Filosofia" },
  { parole: ["psycholog"], nome: "Psicologia" },
  { parole: ["business", "economic"], nome: "Economia e Business" }
];

function primaCategoria(categorie) {
  if (!categorie || categorie.length === 0) return null;
  return categorie[0];
}

function generePerVisualizzazione(categorie) {
  const cat = primaCategoria(categorie);
  if (!cat) return "Senza genere";
  const primoSegmento = cat.split("/")[0].trim();
  const chiave = primoSegmento.toLowerCase();

  if (MAPPA_GENERI[chiave]) return MAPPA_GENERI[chiave];

  for (const voce of PAROLE_CHIAVE_GENERE) {
    if (voce.parole.some((parola) => chiave.includes(parola))) return voce.nome;
  }

  // Non riconosciuto: capitalizza comunque la prima lettera per coerenza visiva
  return primoSegmento.charAt(0).toUpperCase() + primoSegmento.slice(1);
}

/* ---------- ISBN ---------- */
function puliziaIsbn(isbn) {
  if (!isbn) return "";
  return isbn.replace(/[^0-9Xx]/g, "").toUpperCase();
}

function isbnValido(isbn) {
  const pulito = puliziaIsbn(isbn);
  return pulito.length === 10 || pulito.length === 13;
}

/* ---------- COSTRUZIONE QUERY GOOGLE BOOKS ---------- */
function costruisciQueryGoogleBooks({ titolo, autore, isbn }) {
  const isbnPulito = puliziaIsbn(isbn);
  if (isbnPulito) {
    return `isbn:${isbnPulito}`;
  }
  let parti = [];
  if (titolo && titolo.trim()) parti.push(`intitle:${titolo.trim()}`);
  if (autore && autore.trim()) parti.push(`inauthor:${autore.trim()}`);
  return parti.join("+");
}

/* ---------- PARSING RISULTATI GOOGLE BOOKS ---------- */
function estraiIsbnDaIdentifiers(industryIdentifiers) {
  if (!industryIdentifiers) return "";
  const isbn13 = industryIdentifiers.find((i) => i.type === "ISBN_13");
  if (isbn13) return isbn13.identifier;
  const isbn10 = industryIdentifiers.find((i) => i.type === "ISBN_10");
  if (isbn10) return isbn10.identifier;
  return "";
}

function copertinaSicura(imageLinks) {
  if (!imageLinks) return "";
  const link = imageLinks.thumbnail || imageLinks.smallThumbnail || "";
  // Google a volte restituisce link http: forziamo https per evitare mixed-content su iOS
  return link.replace(/^http:\/\//, "https://");
}

function parseGoogleBookItem(item) {
  const info = item.volumeInfo || {};
  return {
    sourceId: "gb:" + item.id,
    title: info.title || "Titolo sconosciuto",
    authors: info.authors || [],
    isbn: estraiIsbnDaIdentifiers(info.industryIdentifiers),
    thumbnail: copertinaSicura(info.imageLinks),
    description: info.description || "",
    categories: info.categories || [],
    pageCount: info.pageCount || null,
    publishedDate: info.publishedDate || "",
    language: info.language || ""
  };
}

/* ---------- RICERCA GENERICA OPEN LIBRARY (titolo / autore) ---------- */
function costruisciParametriOpenLibrarySearch({ titolo, autore }) {
  const parametri = {};
  if (titolo && titolo.trim()) parametri.title = titolo.trim();
  if (autore && autore.trim()) parametri.author = autore.trim();
  return parametri;
}

/* Ricerca "generale" (parametro q= di Open Library): a differenza di
   title=/author=, che cercano nel campo "titolo principale" dell'opera
   (quasi sempre quello della prima edizione, spesso in lingua originale),
   q= confronta il testo anche con i titoli alternativi delle altre edizioni
   (incluse le traduzioni italiane), quindi trova più spesso un titolo
   tradotto anche se non è quello "canonico" registrato per l'opera. */
function costruisciQueryGeneraleOpenLibrary({ titolo, autore }) {
  const parti = [];
  if (titolo && titolo.trim()) parti.push(titolo.trim());
  if (autore && autore.trim()) parti.push(autore.trim());
  return parti.join(" ");
}

function migliorIsbnDaLista(listaIsbn) {
  if (!listaIsbn || listaIsbn.length === 0) return "";
  const isbn13 = listaIsbn.find((i) => puliziaIsbn(i).length === 13);
  if (isbn13) return puliziaIsbn(isbn13);
  const isbn10 = listaIsbn.find((i) => puliziaIsbn(i).length === 10);
  if (isbn10) return puliziaIsbn(isbn10);
  return "";
}

function copertinaOpenLibraryDaCoverId(coverId) {
  if (!coverId) return "";
  return `https://covers.openlibrary.org/b/id/${coverId}-M.jpg`;
}

function parseOpenLibrarySearchDoc(doc) {
  return {
    sourceId: "ol:" + doc.key,
    workKey: doc.key || "",
    title: doc.title || "Titolo sconosciuto",
    authors: doc.author_name || [],
    isbn: migliorIsbnDaLista(doc.isbn),
    thumbnail: copertinaOpenLibraryDaCoverId(doc.cover_i),
    description: "", // non disponibile nell'endpoint di ricerca: va caricata a parte, alla bisogna
    categories: doc.subject || [],
    pageCount: doc.number_of_pages_median || null,
    publishedDate: doc.first_publish_year ? String(doc.first_publish_year) : "",
    language: (doc.language && doc.language[0]) || ""
  };
}

/* Estrae il testo del riassunto dalla risposta di .../works/OLxxxW.json */
function estraiDescrizioneOpenLibraryWork(dati) {
  if (!dati || !dati.description) return "";
  if (typeof dati.description === "string") return dati.description;
  if (typeof dati.description === "object" && dati.description.value) return dati.description.value;
  return "";
}

/* ---------- PARSING FALLBACK OPEN LIBRARY (per ISBN) ---------- */
function parseOpenLibraryByIsbn(data, isbnRichiesto) {
  const chiave = "ISBN:" + isbnRichiesto;
  const voce = data[chiave];
  if (!voce) return null;
  return {
    sourceId: "ol:" + isbnRichiesto,
    title: voce.title || "Titolo sconosciuto",
    authors: (voce.authors || []).map((a) => a.name),
    isbn: isbnRichiesto,
    thumbnail: voce.cover ? (voce.cover.medium || voce.cover.large || "") : "",
    description: voce.notes
      ? (typeof voce.notes === "string" ? voce.notes : voce.notes.value || "")
      : (voce.excerpts && voce.excerpts[0] ? voce.excerpts[0].text : ""),
    categories: (voce.subjects || []).map((s) => s.name),
    pageCount: voce.number_of_pages || null,
    publishedDate: voce.publish_date || "",
    language: ""
  };
}

/* ---------- VOTO A STELLE (0 - 5, step 0.5) ---------- */
function arrotondaVoto(valore) {
  if (valore === null || valore === undefined || isNaN(valore)) return null;
  let v = Math.round(valore * 2) / 2;
  if (v < 0) v = 0;
  if (v > 5) v = 5;
  return v;
}

/* ---------- FORMATTAZIONE DATA ---------- */
const MESI_IT = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];

function formattaDataUscita(pubDate) {
  if (!pubDate) return "Data sconosciuta";
  // Google Books può restituire "2001", "2001-05" o "2001-05-12"
  const parti = pubDate.split("-");
  if (parti.length === 1) return parti[0];
  if (parti.length === 2) return `${MESI_IT[parseInt(parti[1], 10) - 1] || ""} ${parti[0]}`;
  return `${parseInt(parti[2], 10)} ${MESI_IT[parseInt(parti[1], 10) - 1] || ""} ${parti[0]}`;
}

function formattaDataItaliana(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return "";
  const giorno = String(d.getDate()).padStart(2, "0");
  const mese = MESI_IT[d.getMonth()];
  return `${giorno} ${mese} ${d.getFullYear()}`;
}

/* Estrae un valore numerico ordinabile dalla data di uscita (usato per i sort) */
function chiaveOrdinamentoDataUscita(pubDate) {
  if (!pubDate) return -1;
  const anno = parseInt(pubDate.split("-")[0], 10);
  if (isNaN(anno)) return -1;
  const mese = pubDate.split("-")[1] ? parseInt(pubDate.split("-")[1], 10) : 1;
  const giorno = pubDate.split("-")[2] ? parseInt(pubDate.split("-")[2], 10) : 1;
  return anno * 10000 + mese * 100 + giorno;
}

/* ---------- ORDINAMENTO LIBRI ----------
   Ritorna sempre un array di "righe" da renderizzare:
   { tipo: 'header', testo } oppure { tipo: 'libro', libro }
   Cos_ì la UI ha una sola funzione di rendering per ogni schermata. */
function ordinaLibri(libri, criterio) {
  const arr = libri.slice();

  if (criterio === "nome") {
    arr.sort((a, b) => a.title.localeCompare(b.title, "it", { sensitivity: "base" }));
    return arr.map((libro) => ({ tipo: "libro", libro }));
  }

  if (criterio === "dataUscita") {
    arr.sort((a, b) => chiaveOrdinamentoDataUscita(b.publishedDate) - chiaveOrdinamentoDataUscita(a.publishedDate));
    return arr.map((libro) => ({ tipo: "libro", libro }));
  }

  if (criterio === "dataAggiunta") {
    arr.sort((a, b) => new Date(b.dataAggiunta) - new Date(a.dataAggiunta));
    return arr.map((libro) => ({ tipo: "libro", libro }));
  }

  if (criterio === "dataLettura") {
    arr.sort((a, b) => new Date(b.dataLettura || 0) - new Date(a.dataLettura || 0));
    return arr.map((libro) => ({ tipo: "libro", libro }));
  }

  if (criterio === "voto") {
    arr.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    return arr.map((libro) => ({ tipo: "libro", libro }));
  }

  if (criterio === "genere") {
    arr.sort((a, b) => {
      const ga = generePerVisualizzazione(a.categories);
      const gb = generePerVisualizzazione(b.categories);
      if (ga === gb) return a.title.localeCompare(b.title, "it", { sensitivity: "base" });
      return ga.localeCompare(gb, "it", { sensitivity: "base" });
    });
    const righe = [];
    let genereCorrente = null;
    for (const libro of arr) {
      const g = generePerVisualizzazione(libro.categories);
      if (g !== genereCorrente) {
        righe.push({ tipo: "header", testo: g });
        genereCorrente = g;
      }
      righe.push({ tipo: "libro", libro });
    }
    return righe;
  }

  // criterio sconosciuto: nessun ordinamento particolare
  return arr.map((libro) => ({ tipo: "libro", libro }));
}

/* ---------- ID LIBRO ----------
   Usato per capire se un libro è già in libreria: se ha ISBN, l'ISBN è la chiave;
   altrimenti usiamo l'id della fonte (Google Books / Open Library). */
function idLibro(libro) {
  const isbnPulito = puliziaIsbn(libro.isbn);
  if (isbnPulito) return "isbn:" + isbnPulito;
  return libro.sourceId;
}

/* Export condizionale: in Node (test) esponiamo tutto via module.exports,
   nel browser le funzioni restano semplicemente nello scope globale dello script. */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    MAPPA_GENERI,
    generePerVisualizzazione,
    puliziaIsbn,
    isbnValido,
    costruisciQueryGoogleBooks,
    parseGoogleBookItem,
    parseOpenLibraryByIsbn,
    costruisciParametriOpenLibrarySearch,
    costruisciQueryGeneraleOpenLibrary,
    parseOpenLibrarySearchDoc,
    estraiDescrizioneOpenLibraryWork,
    migliorIsbnDaLista,
    copertinaOpenLibraryDaCoverId,
    arrotondaVoto,
    formattaDataUscita,
    formattaDataItaliana,
    chiaveOrdinamentoDataUscita,
    ordinaLibri,
    idLibro
  };
}
