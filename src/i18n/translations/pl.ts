import { Translations } from './en';

// AI-translated (Polish) — not yet reviewed by a native speaker. Fine for
// internal use/demos; get a native review pass before this is in front of
// real customers.
const pl: Translations = {
  common: {
    loading: 'Ładowanie…',
    cancel: 'Anuluj',
    retry: 'Spróbuj ponownie',
    save: 'Zapisz',
    saving: 'Zapisywanie…',
    saveDraft: 'Zapisz wersję roboczą',
    submitForApproval: 'Wyślij do zatwierdzenia',
    submitting: 'Wysyłanie…',
    notes: 'Notatki',
    category: 'Kategoria',
    uncategorized: 'Bez kategorii',
    currency: 'Waluta',
    date: 'Data',
    from: 'Z',
    to: 'Do',
    roundTrip: 'W obie strony',
    trip: 'Podróż',
    details: 'Szczegóły',
    amount: 'Kwota',
    startTypingAddress: 'Zacznij wpisywać adres…',
    couldNotCalculateDistance: 'Nie udało się obliczyć odległości',
    distanceKm: 'Odległość (km)',
    calculatingSuffix: ' — obliczanie…',
    unknownVendor: 'Nieznany dostawca',
    mileageFallbackLabel: 'Kilometrówka',
    logOut: 'Wyloguj się'
  },

  table: {
    vendor: 'Dostawca',
    invoiceNumber: 'Nr faktury',
    date: 'Data',
    category: 'Kategoria',
    amount: 'Kwota',
    status: 'Status',
    submittedBy: 'Zgłoszone przez',
    description: 'Opis',
    qty: 'Ilość',
    unitPrice: 'Cena jednostkowa',
    total: 'Razem'
  },

  status: {
    all: 'Wszystkie',
    pending: 'Oczekujące',
    processing: 'Przetwarzanie',
    toReview: 'Do sprawdzenia',
    pendingApproval: 'Oczekuje na zatwierdzenie',
    approved: 'Zatwierdzone',
    rejected: 'Odrzucone',
    failed: 'Nieudane'
  },

  nav: {
    brand: 'Expense Manager',
    brandSub: 'Paragony i zatwierdzenia',
    dashboard: 'Pulpit',
    home: 'Start',
    expenses: 'Wydatki',
    approvals: 'Zatwierdzenia',
    admin: 'Administrator',
    users: 'Użytkownicy',
    settings: 'Ustawienia',
    add: 'Dodaj'
  },

  login: {
    title: 'Zaloguj się',
    subtitle: 'Uzyskaj dostęp do wydatków swojej organizacji',
    email: 'E-mail',
    password: 'Hasło',
    signingIn: 'Logowanie…',
    signIn: 'Zaloguj się',
    failed: 'Logowanie nie powiodło się'
  },

  dashboard: {
    greeting: 'Cześć, {name}',
    subtitle: 'Oto co wymaga dziś Twojej uwagi.',
    addExpense: 'Dodaj wydatek',
    statToReview: 'Do sprawdzenia',
    statRejected: 'Odrzucone — wymaga poprawy',
    statAwaitingApproval: 'Oczekuje na zatwierdzenie',
    statWaitingOnYou: 'Czeka na Twoją decyzję',
    needsAttention: 'Wymaga uwagi',
    viewAllExpenses: 'Zobacz wszystkie wydatki →',
    allCaughtUp: 'Wszystko na bieżąco',
    nothingNeedsAttention: 'Obecnie nic nie wymaga Twojej uwagi.',
    submittedBy: 'zgłoszone przez {name}',
    rejectedFixResubmit: 'odrzucone — popraw i wyślij ponownie'
  },

  expenseList: {
    searchPlaceholder: 'Szukaj dostawcy lub numeru faktury…',
    exportCsv: 'Eksportuj CSV',
    addExpense: '+ Dodaj wydatek',
    loading: 'Ładowanie wydatków…',
    empty: 'Brak wydatków',
    emptyHint: 'Prześlij paragon lub zarejestruj przejazd, aby rozpocząć.',
    duplicateBadge: '⚠ duplikat',
    duplicateTooltip: 'Możliwy duplikat istniejącej faktury',
    previous: 'Poprzednia',
    next: 'Następna',
    pageOf: 'Strona {page} z {totalPages}',
    loadFailed: 'Nie udało się załadować wydatków',
    exportFailed: 'Eksport nie powiódł się'
  },

  addExpense: {
    uploadReceiptTitle: 'Prześlij paragon',
    uploadReceiptDesc: 'Zrób zdjęcie lub prześlij paragon albo fakturę — automatycznie wyodrębnimy dane.',
    logMileageTitle: 'Zarejestruj przejazd',
    logMileageDesc: 'Zarejestruj przejazd na podstawie odległości lub podaj miejsce startu i celu, a obliczymy odległość.'
  },

  upload: {
    selectFileFirst: 'Najpierw wybierz fakturę.',
    extractionFailed: 'Wyodrębnianie nie powiodło się',
    unexpectedError: 'Nieoczekiwany błąd',
    processingTitle: 'Przetwarzanie faktury',
    processingSubtitle: 'Wyodrębnianie danych z dokumentu…',
    stepFileUploaded: 'Plik przesłany',
    stepOcrScanning: 'Skanowanie OCR',
    stepAiStructuring: 'Strukturyzacja AI',
    dropHint: 'Upuść fakturę tutaj lub kliknij, aby przeglądać',
    fileTypeHint: 'Obsługuje JPEG, PNG, PDF • Maks. 10 MB',
    removeFile: 'Usuń',
    processInvoice: 'Przetwórz fakturę'
  },

  mileage: {
    fromPlaceholderNoMaps: 'Berlin HQ',
    toPlaceholderNoMaps: 'Munich Client Office',
    distancePlaceholder: 'Wypełnia się automatycznie lub wpisz ręcznie',
    saveFailed: 'Nie udało się zapisać przejazdu',
    submitFailed: 'Nie udało się wysłać przejazdu'
  },

  approvalQueue: {
    title: 'Oczekuje na Twoje zatwierdzenie',
    loadFailed: 'Nie udało się załadować zatwierdzeń',
    empty: 'Nic nie czeka na Twoją decyzję',
    emptyHint: 'Wydatki zgłoszone przez Twój zespół pojawią się tutaj.'
  },

  adminUsers: {
    title: 'Użytkownicy',
    addUser: 'Dodaj użytkownika',
    name: 'Imię i nazwisko',
    email: 'E-mail',
    password: 'Hasło',
    role: 'Rola',
    manager: 'Menedżer (zatwierdzający)',
    roleEmployee: 'Pracownik',
    roleApprover: 'Zatwierdzający',
    roleAdmin: 'Administrator',
    noManager: 'Brak menedżera (samodzielne zatwierdzenie przy wysyłaniu)',
    adding: 'Dodawanie…',
    addUserButton: 'Dodaj użytkownika',
    loading: 'Ładowanie użytkowników…',
    reportsTo: 'Podlega',
    userAdded: '{name} został dodany.',
    loadFailed: 'Nie udało się załadować użytkowników',
    createFailed: 'Nie udało się utworzyć użytkownika'
  },

  adminSettings: {
    title: 'Ustawienia',
    loading: 'Ładowanie ustawień…',
    loadFailed: 'Nie udało się załadować ustawień',
    saveFailed: 'Nie udało się zapisać ustawień',
    saved: 'Ustawienia zapisane.',
    currencySection: 'Waluta',
    defaultCurrency: 'Domyślna waluta',
    currencyHint:
      'Wyodrębnione paragony w innej walucie są automatycznie przeliczane na tę walutę — pierwotnie zarejestrowana kwota pozostaje widoczna i można ją przywrócić w wydatku. Kilometrówka jest zawsze rozliczana w tej walucie.',
    languageSection: 'Język',
    defaultLanguage: 'Domyślny język',
    languageHint: 'Dotyczy osób, które nie wybrały jeszcze własnego języka w menu konta.',
    mileageSection: 'Kilometrówka',
    mileageRate: 'Stawka zwrotu (za km)',
    mileageRateInvalid: 'Podaj stawkę za kilometr większą niż 0.',
    mileageHint:
      'Stosowana do każdego wydatku kilometrowego w organizacji — odległość × (w obie strony ? 2 : 1) × ta stawka. Już wysłane wydatki zachowują kwotę, z jaką zostały zapisane; dotyczy to tylko nowych i edytowanych wydatków.',
    saveSettings: 'Zapisz ustawienia'
  },

  review: {
    loading: 'Ładowanie wydatku…',
    notFound: 'Nie znaleziono wydatku',
    backToExpenses: 'Powrót do wydatków',
    allExpenses: '← Wszystkie wydatki',
    reject: 'Odrzuć',
    approve: 'Zatwierdź',
    approving: 'Zatwierdzanie…',
    reasonForRejecting: 'Powód odrzucenia',
    rejectPlaceholder: 'Poinformuj zgłaszającego, co należy zmienić…',
    confirmRejection: 'Potwierdź odrzucenie',
    rejecting: 'Odrzucanie…',
    autoExtractedNotice: 'Automatycznie wyodrębniliśmy te pola — sprawdź je przed wysłaniem.',
    duplicateNotice:
      '⚠ To wygląda na duplikat wydatku już istniejącego w systemie (ten sam dostawca, numer i kwota).',
    extractionFailed: 'Wyodrębnianie nie powiodło się',
    extractionFailedManualHint: 'Możesz nadal wypełnić pola ręcznie poniżej.',
    submitted: 'Wysłano',
    waitingOnApproval: ' — oczekuje na zatwierdzenie przez {name}',
    submittedForYou: 'Wysłane przez {name}. Sprawdź szczegóły i zatwierdź lub odrzuć poniżej.',
    approvedBy: 'Zatwierdzone przez {name}',
    approvedOnDate: ' w dniu {date}',
    approvedCommentQuote: ' „{comment}"',
    rejectedBy: 'Odrzucone przez {name}: „{comment}". Popraw szczegóły poniżej i wyślij ponownie.',
    loadFailed: 'Nie udało się załadować wydatku',
    saveDraftFailed: 'Nie udało się zapisać zmian',
    submitFailed: 'Nie udało się wysłać do zatwierdzenia',
    approveFailed: 'Nie udało się zatwierdzić',
    rejectFailed: 'Nie udało się odrzucić',
    rejectReasonRequired: 'Wyjaśnij, dlaczego odrzucasz ten wydatek.',
    openDocument: 'Otwórz dokument',
    loadingPreview: 'Ładowanie podglądu…',
    vendorSection: 'Dostawca',
    vendorName: 'Nazwa dostawcy',
    taxId: 'NIP',
    vendorAddress: 'Adres dostawcy',
    invoiceSection: 'Faktura',
    invoiceNumber: 'Numer faktury',
    invoiceDate: 'Data faktury',
    dueDate: 'Termin płatności',
    amountsSection: 'Kwoty',
    subtotal: 'Suma częściowa',
    taxRate: 'Stawka VAT (%)',
    taxAmount: 'Kwota VAT',
    totalAmount: 'Kwota całkowita',
    paymentMethod: 'Metoda płatności',
    paymentTerms: 'Warunki płatności',
    originallyCaptured: 'Pierwotnie zarejestrowano jako {amount} {currency}',
    convertedAt: ' (przeliczono po kursie {rate}',
    convertedOn: ' w dniu {date}',
    useOriginal: 'Użyj oryginału',
    lineItems: 'Pozycje',
    totalCalculated: 'Razem (obliczane automatycznie)'
  },

  routeMap: {
    loadFailed: 'Nie udało się załadować mapy.',
    routeFailed: 'Nie udało się pokazać trasy na mapie.'
  }
};

export default pl;
