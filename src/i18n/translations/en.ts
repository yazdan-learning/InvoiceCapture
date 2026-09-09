// The key set is defined here — every other language file must have exactly
// the same keys. Grouped by page/area; keys used identically in more than one
// place are shared (see the `common`/`table`/`status` groups) rather than
// duplicated — but near-duplicates that read differently today (e.g. the
// sidebar's "Dashboard" vs. the mobile tab's "Home" for the same route) are
// kept as separate keys with their current wording, not silently merged.
const en = {
  // ===== Common / shared across pages =====
  common: {
    loading: 'Loading…',
    cancel: 'Cancel',
    retry: 'Retry',
    save: 'Save',
    saving: 'Saving…',
    saveDraft: 'Save draft',
    submitForApproval: 'Submit for approval',
    submitting: 'Submitting…',
    notes: 'Notes',
    category: 'Category',
    uncategorized: 'Uncategorized',
    currency: 'Currency',
    date: 'Date',
    from: 'From',
    to: 'To',
    roundTrip: 'Round trip',
    trip: 'Trip',
    details: 'Details',
    amount: 'Amount',
    startTypingAddress: 'Start typing an address…',
    couldNotCalculateDistance: 'Could not calculate distance',
    distanceKm: 'Distance (km)',
    calculatingSuffix: ' — calculating…',
    unknownVendor: 'Unknown vendor',
    mileageFallbackLabel: 'Mileage',
    logOut: 'Log out',
    edit: 'Edit',
    delete: 'Delete',
    deleting: 'Deleting…',
    confirm: 'Confirm'
  },

  // ===== Table headers =====
  table: {
    vendor: 'Vendor',
    invoiceNumber: 'Invoice #',
    date: 'Date',
    category: 'Category',
    amount: 'Amount',
    status: 'Status',
    submittedBy: 'Submitted by',
    description: 'Description',
    qty: 'Qty',
    unitPrice: 'Unit price',
    total: 'Total'
  },

  // ===== Status labels (StatusPill + list-page filter tabs) =====
  status: {
    all: 'All',
    pending: 'Pending',
    processing: 'Processing',
    toReview: 'To review',
    pendingApproval: 'Pending approval',
    approved: 'Approved',
    rejected: 'Rejected',
    failed: 'Failed'
  },

  // ===== Navigation (Sidebar + MobileNav + shared UserMenu) =====
  nav: {
    brand: 'Expense Manager',
    brandSub: 'Receipts & Approvals',
    dashboard: 'Dashboard',
    home: 'Home',
    expenses: 'Expenses',
    approvals: 'Approvals',
    admin: 'Admin',
    users: 'Users',
    settings: 'Settings',
    add: 'Add'
  },

  // ===== Login =====
  login: {
    title: 'Sign in',
    subtitle: "Access your organization's expenses",
    email: 'Email',
    password: 'Password',
    signingIn: 'Signing in…',
    signIn: 'Sign in',
    failed: 'Login failed'
  },

  // ===== Dashboard =====
  dashboard: {
    greeting: 'Hi, {name}',
    subtitle: "Here's what needs your attention today.",
    addExpense: 'Add Expense',
    statToReview: 'To review',
    statRejected: 'Rejected — needs fixing',
    statAwaitingApproval: 'Awaiting approval',
    statWaitingOnYou: 'Waiting on your decision',
    needsAttention: 'Needs your attention',
    viewAllExpenses: 'View all expenses →',
    allCaughtUp: "You're all caught up",
    nothingNeedsAttention: 'Nothing needs your attention right now.',
    submittedBy: 'submitted by {name}',
    rejectedFixResubmit: 'rejected — fix and resubmit'
  },

  // ===== Expense list =====
  expenseList: {
    searchPlaceholder: 'Search vendor or invoice number…',
    exportCsv: 'Export CSV',
    addExpense: '+ Add Expense',
    loading: 'Loading expenses…',
    empty: 'No expenses yet',
    emptyHint: 'Upload a receipt or log mileage to get started.',
    duplicateBadge: '⚠ duplicate',
    duplicateTooltip: 'Possible duplicate of an existing invoice',
    previous: 'Previous',
    next: 'Next',
    pageOf: 'Page {page} of {totalPages}',
    loadFailed: 'Failed to load expenses',
    exportFailed: 'Export failed'
  },

  // ===== Add-expense chooser =====
  addExpense: {
    uploadReceiptTitle: 'Upload receipt',
    uploadReceiptDesc: "Snap or upload a photo of a receipt or invoice — we'll extract the details automatically.",
    logMileageTitle: 'Log mileage',
    logMileageDesc: "Record a trip by distance, or enter a start and end location and we'll calculate it."
  },

  // ===== Upload (receipt) =====
  upload: {
    selectFileFirst: 'Please select an invoice first.',
    extractionFailed: 'Extraction failed',
    unexpectedError: 'Unexpected error',
    processingTitle: 'Processing Invoice',
    processingSubtitle: 'Extracting data from your document…',
    stepFileUploaded: 'File uploaded',
    stepOcrScanning: 'OCR scanning',
    stepAiStructuring: 'AI structuring',
    dropHint: 'Drop invoice here or click to browse',
    fileTypeHint: 'Supports JPEG, PNG, PDF • Max 10MB',
    removeFile: 'Remove',
    processInvoice: 'Process Invoice'
  },

  // ===== Mileage entry / mileage branch of review page =====
  mileage: {
    fromPlaceholderNoMaps: 'Berlin HQ',
    toPlaceholderNoMaps: 'Munich Client Office',
    distancePlaceholder: 'Fills in automatically, or type it yourself',
    saveFailed: 'Failed to save mileage expense',
    submitFailed: 'Failed to submit mileage expense'
  },

  // ===== Approval queue =====
  approvalQueue: {
    title: 'Pending your approval',
    loadFailed: 'Failed to load approvals',
    empty: 'Nothing waiting on you',
    emptyHint: 'Expenses submitted by your team will show up here.'
  },

  // ===== Admin: Users =====
  adminUsers: {
    title: 'Users',
    addUser: 'Add a user',
    name: 'Name',
    email: 'Email',
    password: 'Password',
    role: 'Role',
    manager: 'Manager (approver)',
    roleEmployee: 'Employee',
    roleApprover: 'Approver',
    roleAdmin: 'Admin',
    noManager: 'No manager (self-certifies on submit)',
    adding: 'Adding…',
    addUserButton: 'Add user',
    loading: 'Loading users…',
    reportsTo: 'Reports to',
    userAdded: '{name} was added.',
    userUpdated: '{name} was updated.',
    loadFailed: 'Failed to load users',
    createFailed: 'Failed to create user',
    editUser: 'Edit user',
    saveChanges: 'Save changes',
    active: 'Active',
    deactivated: 'Deactivated',
    confirmDeactivate: 'Deactivate {name}? They will no longer be able to log in.',
    deactivateFailed: 'Failed to deactivate user'
  },

  // ===== Admin: Settings =====
  adminSettings: {
    title: 'Settings',
    loading: 'Loading settings…',
    loadFailed: 'Failed to load settings',
    saveFailed: 'Failed to save settings',
    saved: 'Settings saved.',
    currencySection: 'Currency',
    defaultCurrency: 'Default currency',
    currencyHint:
      'Extracted receipts in a different currency are automatically converted into this one — the original captured amount stays visible and can be restored on the expense. Mileage reimbursement is always in this currency.',
    languageSection: 'Language',
    defaultLanguage: 'Default language',
    languageHint: "Used for anyone who hasn't chosen their own language in the account menu.",
    mileageSection: 'Mileage',
    mileageRate: 'Reimbursement rate (per km)',
    mileageRateInvalid: 'Enter a mileage rate greater than 0.',
    mileageHint:
      'Applied to every mileage expense across the organization — distance × (round trip ? 2 : 1) × this rate. Existing submitted expenses keep the total they were saved with; this only affects new and edited ones.',
    saveSettings: 'Save settings'
  },

  // ===== Expense review page =====
  review: {
    loading: 'Loading expense…',
    notFound: 'Expense not found',
    backToExpenses: 'Back to expenses',
    allExpenses: '← All expenses',
    reject: 'Reject',
    approve: 'Approve',
    approving: 'Approving…',
    reasonForRejecting: 'Reason for rejecting',
    rejectPlaceholder: 'Let the submitter know what needs to change…',
    confirmRejection: 'Confirm rejection',
    rejecting: 'Rejecting…',
    autoExtractedNotice: 'We extracted these fields automatically — check them over before submitting.',
    duplicateNotice: '⚠ This looks like a possible duplicate of an expense already in the system (same vendor, expense number, and amount).',
    extractionFailed: 'Extraction failed',
    extractionFailedManualHint: 'You can still fill in the fields manually below.',
    submitted: 'Submitted',
    waitingOnApproval: ' — waiting on {name}\'s approval',
    submittedForYou: 'Submitted by {name}. Review the details and approve or reject below.',
    approvedBy: 'Approved by {name}',
    approvedOnDate: ' on {date}',
    approvedCommentQuote: ' "{comment}"',
    rejectedBy: 'Rejected by {name}: "{comment}". Fix the details below and submit again.',
    loadFailed: 'Failed to load expense',
    saveDraftFailed: 'Failed to save changes',
    submitFailed: 'Failed to submit for approval',
    approveFailed: 'Failed to approve',
    rejectFailed: 'Failed to reject',
    rejectReasonRequired: 'Please explain why you are rejecting this expense.',
    openDocument: 'Open document',
    loadingPreview: 'Loading preview…',
    vendorSection: 'Vendor',
    vendorName: 'Vendor name',
    taxId: 'Tax ID',
    vendorAddress: 'Vendor address',
    invoiceSection: 'Invoice',
    invoiceNumber: 'Invoice number',
    invoiceDate: 'Invoice date',
    dueDate: 'Due date',
    amountsSection: 'Amounts',
    subtotal: 'Subtotal',
    taxRate: 'Tax rate (%)',
    taxAmount: 'Tax amount',
    totalAmount: 'Total amount',
    paymentMethod: 'Payment method',
    paymentTerms: 'Payment terms',
    originallyCaptured: 'Originally captured as {amount} {currency}',
    convertedAt: ' (converted at {rate}',
    convertedOn: ' on {date}',
    useOriginal: 'Use original',
    lineItems: 'Line items',
    totalCalculated: 'Total (calculated automatically)',
    delete: 'Delete',
    confirmDelete: 'Delete this expense? This cannot be undone.',
    deleteFailed: 'Failed to delete expense'
  },

  // ===== RouteMap =====
  routeMap: {
    loadFailed: 'Could not load the map.',
    routeFailed: 'Could not show this route on the map.'
  }
};

export default en;
export type Translations = typeof en;
