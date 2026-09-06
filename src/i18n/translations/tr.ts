import { Translations } from './en';

// AI-translated (Turkish) — not yet reviewed by a native speaker. Fine for
// internal use/demos; get a native review pass before this is in front of
// real customers.
const tr: Translations = {
  common: {
    loading: 'Yükleniyor…',
    cancel: 'İptal',
    retry: 'Tekrar dene',
    save: 'Kaydet',
    saving: 'Kaydediliyor…',
    saveDraft: 'Taslak olarak kaydet',
    submitForApproval: 'Onaya gönder',
    submitting: 'Gönderiliyor…',
    notes: 'Notlar',
    category: 'Kategori',
    uncategorized: 'Kategorisiz',
    currency: 'Para birimi',
    date: 'Tarih',
    from: 'Nereden',
    to: 'Nereye',
    roundTrip: 'Gidiş-dönüş',
    trip: 'Seyahat',
    details: 'Detaylar',
    amount: 'Tutar',
    startTypingAddress: 'Adres yazmaya başlayın…',
    couldNotCalculateDistance: 'Mesafe hesaplanamadı',
    distanceKm: 'Mesafe (km)',
    calculatingSuffix: ' — hesaplanıyor…',
    unknownVendor: 'Bilinmeyen satıcı',
    mileageFallbackLabel: 'Kilometre',
    logOut: 'Çıkış yap'
  },

  table: {
    vendor: 'Satıcı',
    invoiceNumber: 'Fatura No',
    date: 'Tarih',
    category: 'Kategori',
    amount: 'Tutar',
    status: 'Durum',
    submittedBy: 'Gönderen',
    description: 'Açıklama',
    qty: 'Adet',
    unitPrice: 'Birim fiyat',
    total: 'Toplam'
  },

  status: {
    all: 'Tümü',
    pending: 'Beklemede',
    processing: 'İşleniyor',
    toReview: 'İncelenecek',
    pendingApproval: 'Onay bekliyor',
    approved: 'Onaylandı',
    rejected: 'Reddedildi',
    failed: 'Başarısız'
  },

  nav: {
    brand: 'Expense Manager',
    brandSub: 'Fişler ve Onaylar',
    dashboard: 'Panel',
    home: 'Ana Sayfa',
    expenses: 'Giderler',
    approvals: 'Onaylar',
    admin: 'Yönetici',
    users: 'Kullanıcılar',
    settings: 'Ayarlar',
    add: 'Ekle'
  },

  login: {
    title: 'Giriş yap',
    subtitle: 'Kuruluşunuzun giderlerine erişin',
    email: 'E-posta',
    password: 'Şifre',
    signingIn: 'Giriş yapılıyor…',
    signIn: 'Giriş yap',
    failed: 'Giriş başarısız'
  },

  dashboard: {
    greeting: 'Merhaba, {name}',
    subtitle: 'Bugün ilginizi gerektiren konular.',
    addExpense: 'Gider Ekle',
    statToReview: 'İncelenecek',
    statRejected: 'Reddedildi — düzeltme gerekiyor',
    statAwaitingApproval: 'Onay bekliyor',
    statWaitingOnYou: 'Kararınızı bekliyor',
    needsAttention: 'İlginizi gerektiren',
    viewAllExpenses: 'Tüm giderleri görüntüle →',
    allCaughtUp: 'Her şey tamam',
    nothingNeedsAttention: 'Şu anda ilginizi gerektiren bir şey yok.',
    submittedBy: '{name} tarafından gönderildi',
    rejectedFixResubmit: 'reddedildi — düzeltip yeniden gönderin'
  },

  expenseList: {
    searchPlaceholder: 'Satıcı veya fatura numarası ara…',
    exportCsv: 'CSV olarak dışa aktar',
    addExpense: '+ Gider Ekle',
    loading: 'Giderler yükleniyor…',
    empty: 'Henüz gider yok',
    emptyHint: 'Başlamak için bir fiş yükleyin veya kilometre kaydı oluşturun.',
    duplicateBadge: '⚠ yinelenen',
    duplicateTooltip: 'Mevcut bir faturanın olası kopyası',
    previous: 'Önceki',
    next: 'Sonraki',
    pageOf: 'Sayfa {page} / {totalPages}',
    loadFailed: 'Giderler yüklenemedi',
    exportFailed: 'Dışa aktarma başarısız oldu'
  },

  addExpense: {
    uploadReceiptTitle: 'Fiş yükle',
    uploadReceiptDesc:
      'Bir fiş veya faturanın fotoğrafını çekin ya da yükleyin — ayrıntıları otomatik olarak çıkaracağız.',
    logMileageTitle: 'Kilometre kaydet',
    logMileageDesc:
      'Bir seyahati mesafeye göre kaydedin veya başlangıç ve bitiş noktasını girin, mesafeyi biz hesaplayalım.'
  },

  upload: {
    selectFileFirst: 'Lütfen önce bir fatura seçin.',
    extractionFailed: 'Veri çıkarma başarısız oldu',
    unexpectedError: 'Beklenmeyen hata',
    processingTitle: 'Fatura İşleniyor',
    processingSubtitle: 'Belgenizden veriler çıkarılıyor…',
    stepFileUploaded: 'Dosya yüklendi',
    stepOcrScanning: 'OCR taraması',
    stepAiStructuring: 'Yapay zeka yapılandırması',
    dropHint: 'Faturayı buraya bırakın veya göz atmak için tıklayın',
    fileTypeHint: 'JPEG, PNG, PDF destekler • Maks. 10 MB',
    removeFile: 'Kaldır',
    processInvoice: 'Faturayı İşle'
  },

  mileage: {
    fromPlaceholderNoMaps: 'Berlin HQ',
    toPlaceholderNoMaps: 'Munich Client Office',
    distancePlaceholder: 'Otomatik doldurulur veya kendiniz girin',
    saveFailed: 'Kilometre gideri kaydedilemedi',
    submitFailed: 'Kilometre gideri gönderilemedi'
  },

  approvalQueue: {
    title: 'Onayınızı bekleyenler',
    loadFailed: 'Onaylar yüklenemedi',
    empty: 'Sizi bekleyen bir şey yok',
    emptyHint: 'Ekibiniz tarafından gönderilen giderler burada görünecek.'
  },

  adminUsers: {
    title: 'Kullanıcılar',
    addUser: 'Kullanıcı ekle',
    name: 'Ad',
    email: 'E-posta',
    password: 'Şifre',
    role: 'Rol',
    manager: 'Yönetici (onaylayan)',
    roleEmployee: 'Çalışan',
    roleApprover: 'Onaylayan',
    roleAdmin: 'Yönetici',
    noManager: 'Yönetici yok (gönderirken kendi kendini onaylar)',
    adding: 'Ekleniyor…',
    addUserButton: 'Kullanıcı ekle',
    loading: 'Kullanıcılar yükleniyor…',
    reportsTo: 'Bağlı olduğu kişi',
    userAdded: '{name} eklendi.',
    loadFailed: 'Kullanıcılar yüklenemedi',
    createFailed: 'Kullanıcı oluşturulamadı'
  },

  adminSettings: {
    title: 'Ayarlar',
    loading: 'Ayarlar yükleniyor…',
    loadFailed: 'Ayarlar yüklenemedi',
    saveFailed: 'Ayarlar kaydedilemedi',
    saved: 'Ayarlar kaydedildi.',
    currencySection: 'Para Birimi',
    defaultCurrency: 'Varsayılan para birimi',
    currencyHint:
      'Farklı bir para biriminde çıkarılan fişler otomatik olarak bu para birimine dönüştürülür — orijinal kaydedilen tutar görünür kalır ve gider üzerinde geri yüklenebilir. Kilometre ödemesi her zaman bu para biriminde yapılır.',
    languageSection: 'Dil',
    defaultLanguage: 'Varsayılan dil',
    languageHint: 'Hesap menüsünden kendi dilini seçmemiş kullanıcılar için geçerlidir.',
    mileageSection: 'Kilometre',
    mileageRate: 'Geri ödeme oranı (km başına)',
    mileageRateInvalid: "0'dan büyük bir kilometre oranı girin.",
    mileageHint:
      'Kuruluştaki her kilometre giderine uygulanır — mesafe × (gidiş-dönüş ? 2 : 1) × bu oran. Zaten gönderilmiş giderler kaydedildikleri tutarı korur; bu yalnızca yeni ve düzenlenen giderleri etkiler.',
    saveSettings: 'Ayarları kaydet'
  },

  review: {
    loading: 'Gider yükleniyor…',
    notFound: 'Gider bulunamadı',
    backToExpenses: 'Giderlere dön',
    allExpenses: '← Tüm Giderler',
    reject: 'Reddet',
    approve: 'Onayla',
    approving: 'Onaylanıyor…',
    reasonForRejecting: 'Reddetme nedeni',
    rejectPlaceholder: 'Gönderen kişiye nelerin değişmesi gerektiğini bildirin…',
    confirmRejection: 'Reddi onayla',
    rejecting: 'Reddediliyor…',
    autoExtractedNotice: 'Bu alanları otomatik olarak çıkardık — göndermeden önce kontrol edin.',
    duplicateNotice:
      '⚠ Bu, sistemde zaten bulunan bir giderin olası bir kopyası gibi görünüyor (aynı satıcı, numara ve tutar).',
    extractionFailed: 'Veri çıkarma başarısız oldu',
    extractionFailedManualHint: 'Alanları aşağıdan manuel olarak doldurmaya devam edebilirsiniz.',
    submitted: 'Gönderildi',
    waitingOnApproval: ' — {name} onayını bekliyor',
    submittedForYou: '{name} tarafından gönderildi. Ayrıntıları inceleyin ve aşağıdan onaylayın veya reddedin.',
    approvedBy: '{name} tarafından onaylandı',
    approvedOnDate: ' — {date} tarihinde',
    approvedCommentQuote: ' "{comment}"',
    rejectedBy: '{name} tarafından reddedildi: "{comment}". Ayrıntıları aşağıdan düzeltip yeniden gönderin.',
    loadFailed: 'Gider yüklenemedi',
    saveDraftFailed: 'Değişiklikler kaydedilemedi',
    submitFailed: 'Onaya gönderilemedi',
    approveFailed: 'Onaylanamadı',
    rejectFailed: 'Reddedilemedi',
    rejectReasonRequired: 'Lütfen bu gideri neden reddettiğinizi açıklayın.',
    openDocument: 'Belgeyi aç',
    loadingPreview: 'Önizleme yükleniyor…',
    vendorSection: 'Satıcı',
    vendorName: 'Satıcı adı',
    taxId: 'Vergi No',
    vendorAddress: 'Satıcı adresi',
    invoiceSection: 'Fatura',
    invoiceNumber: 'Fatura numarası',
    invoiceDate: 'Fatura tarihi',
    dueDate: 'Son ödeme tarihi',
    amountsSection: 'Tutarlar',
    subtotal: 'Ara toplam',
    taxRate: 'Vergi oranı (%)',
    taxAmount: 'Vergi tutarı',
    totalAmount: 'Toplam tutar',
    paymentMethod: 'Ödeme yöntemi',
    paymentTerms: 'Ödeme koşulları',
    originallyCaptured: 'Aslında {amount} {currency} olarak kaydedildi',
    convertedAt: ' ({rate} kurundan dönüştürüldü',
    convertedOn: ' — {date} tarihinde',
    useOriginal: 'Orijinali kullan',
    lineItems: 'Kalemler',
    totalCalculated: 'Toplam (otomatik hesaplanır)'
  },

  routeMap: {
    loadFailed: 'Harita yüklenemedi.',
    routeFailed: 'Bu güzergah haritada gösterilemedi.'
  }
};

export default tr;
