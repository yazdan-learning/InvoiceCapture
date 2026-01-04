// Simple mock backend for local testing
// Usage: npm run mock:server
import express from 'express';
import multer from 'multer';
import cors from 'cors';

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const port = process.env.PORT || 3000;

app.use(cors());

app.post('/api/extract', upload.single('file'), (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).send('No file uploaded');
  }

  const now = new Date().toISOString();
  const useOcrFirst = req.body.useOcrFirst !== 'false';

  // This is a stub. Replace with real OCR + AI call (n8n webhook or Node service).
  const mockResponse = {
    success: true,
    message: 'Mock extraction complete',
    timestamp: now,
    data: {
      invoiceNumber: 'INV-2024-001',
      invoiceDate: '2024-10-15',
      dueDate: '2024-11-15',
      vendorName: 'Acme Supplies LLC',
      vendorAddress: '123 Market St, San Francisco, CA',
      vendorTaxId: 'TAX-123456',
      customerName: 'Demo Customer Inc.',
      customerAddress: '45 Finance Ave, New York, NY',
      items: [
        { description: 'Paper reams', quantity: 10, unitPrice: 4.5, totalPrice: 45 },
        { description: 'Ink cartridges', quantity: 2, unitPrice: 35, totalPrice: 70 }
      ],
      subtotal: 115,
      taxRate: 8.5,
      taxAmount: 9.78,
      totalAmount: 124.78,
      currency: 'USD',
      paymentTerms: 'Net 30',
      notes: `Processed ${file.originalname} with${useOcrFirst ? '' : 'out'} OCR step`
    },
    metadata: {
      receivedFile: file.originalname,
      sizeBytes: file.size,
      mimeType: file.mimetype,
      useOcrFirst
    }
  };

  res.json(mockResponse);
});

app.listen(port, () => {
  console.log(`Mock backend listening on http://localhost:${port}`);
});


