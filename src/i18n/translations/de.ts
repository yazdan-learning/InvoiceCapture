import { Translations } from './en';

// AI-translated (German, formal "Sie" register for a business tool) — not yet
// reviewed by a native speaker. Fine for internal use/demos; get a native
// review pass before this is in front of real customers.
const de: Translations = {
  common: {
    loading: 'Wird geladen…',
    cancel: 'Abbrechen',
    retry: 'Erneut versuchen',
    save: 'Speichern',
    saving: 'Wird gespeichert…',
    saveDraft: 'Entwurf speichern',
    submitForApproval: 'Zur Genehmigung einreichen',
    submitting: 'Wird eingereicht…',
    notes: 'Notizen',
    category: 'Kategorie',
    uncategorized: 'Nicht kategorisiert',
    currency: 'Währung',
    date: 'Datum',
    from: 'Von',
    to: 'Nach',
    roundTrip: 'Hin- und Rückfahrt',
    trip: 'Fahrt',
    details: 'Details',
    amount: 'Betrag',
    startTypingAddress: 'Adresse eingeben…',
    couldNotCalculateDistance: 'Entfernung konnte nicht berechnet werden',
    distanceKm: 'Entfernung (km)',
    calculatingSuffix: ' — wird berechnet…',
    unknownVendor: 'Unbekannter Anbieter',
    mileageFallbackLabel: 'Kilometergeld',
    logOut: 'Abmelden'
  },

  table: {
    vendor: 'Anbieter',
    invoiceNumber: 'Rechnungsnr.',
    date: 'Datum',
    category: 'Kategorie',
    amount: 'Betrag',
    status: 'Status',
    submittedBy: 'Eingereicht von',
    description: 'Beschreibung',
    qty: 'Menge',
    unitPrice: 'Einzelpreis',
    total: 'Gesamt'
  },

  status: {
    all: 'Alle',
    pending: 'Ausstehend',
    processing: 'In Bearbeitung',
    toReview: 'Zu prüfen',
    pendingApproval: 'Genehmigung ausstehend',
    approved: 'Genehmigt',
    rejected: 'Abgelehnt',
    failed: 'Fehlgeschlagen'
  },

  nav: {
    brand: 'Expense Manager',
    brandSub: 'Belege & Genehmigungen',
    dashboard: 'Übersicht',
    home: 'Start',
    expenses: 'Ausgaben',
    approvals: 'Genehmigungen',
    admin: 'Admin',
    users: 'Benutzer',
    settings: 'Einstellungen',
    add: 'Hinzufügen'
  },

  login: {
    title: 'Anmelden',
    subtitle: 'Zugriff auf die Ausgaben Ihrer Organisation',
    email: 'E-Mail',
    password: 'Passwort',
    signingIn: 'Anmeldung läuft…',
    signIn: 'Anmelden',
    failed: 'Anmeldung fehlgeschlagen'
  },

  dashboard: {
    greeting: 'Hallo, {name}',
    subtitle: 'Das erfordert heute Ihre Aufmerksamkeit.',
    addExpense: 'Ausgabe hinzufügen',
    statToReview: 'Zu prüfen',
    statRejected: 'Abgelehnt — muss korrigiert werden',
    statAwaitingApproval: 'Genehmigung ausstehend',
    statWaitingOnYou: 'Wartet auf Ihre Entscheidung',
    needsAttention: 'Erfordert Ihre Aufmerksamkeit',
    viewAllExpenses: 'Alle Ausgaben anzeigen →',
    allCaughtUp: 'Alles erledigt',
    nothingNeedsAttention: 'Im Moment ist nichts zu erledigen.',
    submittedBy: 'eingereicht von {name}',
    rejectedFixResubmit: 'abgelehnt — korrigieren und erneut einreichen'
  },

  expenseList: {
    searchPlaceholder: 'Anbieter oder Rechnungsnummer suchen…',
    exportCsv: 'CSV exportieren',
    addExpense: '+ Ausgabe hinzufügen',
    loading: 'Ausgaben werden geladen…',
    empty: 'Noch keine Ausgaben',
    emptyHint: 'Laden Sie einen Beleg hoch oder erfassen Sie eine Fahrt, um zu beginnen.',
    duplicateBadge: '⚠ Duplikat',
    duplicateTooltip: 'Möglicherweise ein Duplikat einer bestehenden Rechnung',
    previous: 'Zurück',
    next: 'Weiter',
    pageOf: 'Seite {page} von {totalPages}',
    loadFailed: 'Ausgaben konnten nicht geladen werden',
    exportFailed: 'Export fehlgeschlagen'
  },

  addExpense: {
    uploadReceiptTitle: 'Beleg hochladen',
    uploadReceiptDesc:
      'Fotografieren oder laden Sie einen Beleg oder eine Rechnung hoch — wir extrahieren die Details automatisch.',
    logMileageTitle: 'Fahrt erfassen',
    logMileageDesc:
      'Erfassen Sie eine Fahrt anhand der Entfernung oder geben Sie Start- und Zielort ein — wir berechnen die Entfernung für Sie.'
  },

  upload: {
    selectFileFirst: 'Bitte wählen Sie zunächst eine Rechnung aus.',
    extractionFailed: 'Extraktion fehlgeschlagen',
    unexpectedError: 'Unerwarteter Fehler',
    processingTitle: 'Rechnung wird verarbeitet',
    processingSubtitle: 'Daten werden aus Ihrem Dokument extrahiert…',
    stepFileUploaded: 'Datei hochgeladen',
    stepOcrScanning: 'OCR-Scan',
    stepAiStructuring: 'KI-Strukturierung',
    dropHint: 'Rechnung hier ablegen oder klicken zum Durchsuchen',
    fileTypeHint: 'Unterstützt JPEG, PNG, PDF • Max. 10 MB',
    removeFile: 'Entfernen',
    processInvoice: 'Rechnung verarbeiten'
  },

  mileage: {
    fromPlaceholderNoMaps: 'Berlin HQ',
    toPlaceholderNoMaps: 'Munich Client Office',
    distancePlaceholder: 'Wird automatisch ausgefüllt oder selbst eingeben',
    saveFailed: 'Fahrt konnte nicht gespeichert werden',
    submitFailed: 'Fahrt konnte nicht eingereicht werden'
  },

  approvalQueue: {
    title: 'Zu Ihrer Genehmigung ausstehend',
    loadFailed: 'Genehmigungen konnten nicht geladen werden',
    empty: 'Nichts wartet auf Sie',
    emptyHint: 'Von Ihrem Team eingereichte Ausgaben werden hier angezeigt.'
  },

  adminUsers: {
    title: 'Benutzer',
    addUser: 'Benutzer hinzufügen',
    name: 'Name',
    email: 'E-Mail',
    password: 'Passwort',
    role: 'Rolle',
    manager: 'Manager (Genehmiger)',
    roleEmployee: 'Mitarbeiter',
    roleApprover: 'Genehmiger',
    roleAdmin: 'Admin',
    noManager: 'Kein Manager (Selbstbestätigung bei Einreichung)',
    adding: 'Wird hinzugefügt…',
    addUserButton: 'Benutzer hinzufügen',
    loading: 'Benutzer werden geladen…',
    reportsTo: 'Berichtet an',
    userAdded: '{name} wurde hinzugefügt.',
    loadFailed: 'Benutzer konnten nicht geladen werden',
    createFailed: 'Benutzer konnte nicht erstellt werden'
  },

  adminSettings: {
    title: 'Einstellungen',
    loading: 'Einstellungen werden geladen…',
    loadFailed: 'Einstellungen konnten nicht geladen werden',
    saveFailed: 'Einstellungen konnten nicht gespeichert werden',
    saved: 'Einstellungen gespeichert.',
    currencySection: 'Währung',
    defaultCurrency: 'Standardwährung',
    currencyHint:
      'Extrahierte Belege in einer anderen Währung werden automatisch in diese umgerechnet — der ursprünglich erfasste Betrag bleibt sichtbar und kann bei der Ausgabe wiederhergestellt werden. Kilometergeld wird immer in dieser Währung ausgezahlt.',
    languageSection: 'Sprache',
    defaultLanguage: 'Standardsprache',
    languageHint: 'Gilt für alle, die im Kontomenü noch keine eigene Sprache ausgewählt haben.',
    mileageSection: 'Kilometergeld',
    mileageRate: 'Erstattungssatz (pro km)',
    mileageRateInvalid: 'Geben Sie einen Kilometersatz größer als 0 ein.',
    mileageHint:
      'Wird auf jede Kilometergeld-Ausgabe der Organisation angewendet — Entfernung × (Hin- und Rückfahrt ? 2 : 1) × dieser Satz. Bereits eingereichte Ausgaben behalten den Betrag, mit dem sie gespeichert wurden; dies betrifft nur neue und bearbeitete Ausgaben.',
    saveSettings: 'Einstellungen speichern'
  },

  review: {
    loading: 'Ausgabe wird geladen…',
    notFound: 'Ausgabe nicht gefunden',
    backToExpenses: 'Zurück zu den Ausgaben',
    allExpenses: '← Alle Ausgaben',
    reject: 'Ablehnen',
    approve: 'Genehmigen',
    approving: 'Wird genehmigt…',
    reasonForRejecting: 'Grund für die Ablehnung',
    rejectPlaceholder: 'Teilen Sie dem Einreichenden mit, was geändert werden muss…',
    confirmRejection: 'Ablehnung bestätigen',
    rejecting: 'Wird abgelehnt…',
    autoExtractedNotice: 'Wir haben diese Felder automatisch extrahiert — bitte prüfen Sie sie vor dem Einreichen.',
    duplicateNotice:
      '⚠ Dies scheint ein Duplikat einer bereits im System vorhandenen Ausgabe zu sein (gleicher Anbieter, gleiche Nummer und gleicher Betrag).',
    extractionFailed: 'Extraktion fehlgeschlagen',
    extractionFailedManualHint: 'Sie können die Felder weiterhin manuell unten ausfüllen.',
    submitted: 'Eingereicht',
    waitingOnApproval: ' — wartet auf die Genehmigung von {name}',
    submittedForYou: 'Eingereicht von {name}. Prüfen Sie die Details und genehmigen oder lehnen Sie unten ab.',
    approvedBy: 'Genehmigt von {name}',
    approvedOnDate: ' am {date}',
    approvedCommentQuote: ' „{comment}"',
    rejectedBy: 'Abgelehnt von {name}: „{comment}". Korrigieren Sie die Details unten und reichen Sie erneut ein.',
    loadFailed: 'Ausgabe konnte nicht geladen werden',
    saveDraftFailed: 'Änderungen konnten nicht gespeichert werden',
    submitFailed: 'Einreichung zur Genehmigung fehlgeschlagen',
    approveFailed: 'Genehmigung fehlgeschlagen',
    rejectFailed: 'Ablehnung fehlgeschlagen',
    rejectReasonRequired: 'Bitte erklären Sie, warum Sie diese Ausgabe ablehnen.',
    openDocument: 'Dokument öffnen',
    loadingPreview: 'Vorschau wird geladen…',
    vendorSection: 'Anbieter',
    vendorName: 'Anbietername',
    taxId: 'Steuernummer',
    vendorAddress: 'Anbieteradresse',
    invoiceSection: 'Rechnung',
    invoiceNumber: 'Rechnungsnummer',
    invoiceDate: 'Rechnungsdatum',
    dueDate: 'Fälligkeitsdatum',
    amountsSection: 'Beträge',
    subtotal: 'Zwischensumme',
    taxRate: 'Steuersatz (%)',
    taxAmount: 'Steuerbetrag',
    totalAmount: 'Gesamtbetrag',
    paymentMethod: 'Zahlungsmethode',
    paymentTerms: 'Zahlungsbedingungen',
    originallyCaptured: 'Ursprünglich erfasst als {amount} {currency}',
    convertedAt: ' (umgerechnet zu {rate}',
    convertedOn: ' am {date}',
    useOriginal: 'Original verwenden',
    lineItems: 'Positionen',
    totalCalculated: 'Gesamt (automatisch berechnet)'
  },

  routeMap: {
    loadFailed: 'Karte konnte nicht geladen werden.',
    routeFailed: 'Route konnte auf der Karte nicht angezeigt werden.'
  }
};

export default de;
