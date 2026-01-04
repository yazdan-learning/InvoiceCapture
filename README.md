# InvoiceCapture - Invoice OCR & AI Extraction App

A modern, production-ready React application for capturing and processing invoices using OCR and AI-powered data extraction. Designed for ERP systems, this app allows users to upload invoice images or PDFs and automatically extract structured data.

## Features

- 📸 **Multiple Upload Methods**
  - Drag & drop interface
  - Click to browse files
  - Mobile camera capture support
  - Supports JPEG, PNG, WebP images and PDF files

- 🤖 **AI-Powered Extraction**
  - Mistral OCR for text extraction
  - Groq AI for structured data parsing
  - Automatic field extraction (invoice number, date, vendor, items, totals, etc.)

- 🎨 **Professional UI**
  - Clean, modern design optimized for ERP systems
  - Responsive layout (desktop, tablet, mobile)
  - Real-time processing status indicators
  - Success summary with extracted invoice data

- ⚡ **Fast & Efficient**
  - Built with Vite for optimal performance
  - TypeScript for type safety
  - Optimized bundle size

## Prerequisites

- **Node.js** 18.x or higher
- **npm** 9.x or higher
- **n8n** instance running with the Invoice OCR workflow configured

## Installation

1. **Clone or navigate to the project directory:**
   ```bash
   cd invoice-ocr-app
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment variables:**
   
   Create a `.env` file in the root directory:
   ```env
   VITE_API_BASE_URL=http://localhost:5678
   ```
   
   For production, create `.env.production`:
   ```env
   VITE_API_BASE_URL=https://your-n8n-server.com
   ```

## Development

### Start Development Server

```bash
npm run dev
```

The app will be available at `http://localhost:5173`

### Type Checking

```bash
npm run lint
```

### Preview Production Build

```bash
npm run build
npm run preview
```

## Building for Production

### Build the Application

```bash
npm run build
```

This creates a `dist` folder with optimized production files.

### Deploy to IIS (Windows Server)

1. Copy the `dist` folder to your Windows Server
2. Place it in: `C:\inetpub\wwwroot\invoice-ocr-app\dist`
3. Create `web.config` in the `dist` folder (see Deployment section below)
4. Configure IIS site/application pointing to the `dist` folder
5. Install URL Rewrite module for IIS

### Deploy to Other Platforms

The `dist` folder contains static files that can be deployed to:
- **Nginx**: Copy `dist` to web root, configure routing
- **Apache**: Copy `dist` to `htdocs`, enable mod_rewrite
- **Netlify/Vercel**: Connect repository, auto-deploy on push
- **Docker**: Use nginx image, copy `dist` to `/usr/share/nginx/html`

## Configuration

### API Endpoint

The app connects to an n8n webhook endpoint. Update the API URL:

**Development:**
```env
VITE_API_BASE_URL=http://localhost:5678
```

**Production:**
```env
VITE_API_BASE_URL=https://your-n8n-server.com
```

### Expected n8n Webhook Format

The app expects a webhook at:
```
POST /webhook/invoice-ocr-mistral
```

**Request:**
- `multipart/form-data`
- Field name: `file` (image or PDF)

**Response:**
```json
{
  "success": true,
  "message": "Invoice parsed successfully",
  "timestamp": "2025-01-03T22:21:49.753Z",
  "data": {
    "invoiceNumber": "AAA2025000000064",
    "invoiceDate": "2025-12-16",
    "vendorName": "Company Name",
    "items": [...],
    "totalAmount": 10907.2,
    "currency": "USD"
  }
}
```

## Project Structure

```
invoice-ocr-app/
├── src/
│   ├── App.tsx          # Main application component
│   ├── App.css          # Application styles
│   ├── api.ts           # API client for n8n webhook
│   ├── types.ts         # TypeScript type definitions
│   └── main.tsx         # Application entry point
├── public/              # Static assets
├── dist/                # Production build output
├── package.json         # Dependencies and scripts
├── vite.config.ts       # Vite configuration
├── tsconfig.json        # TypeScript configuration
└── README.md           # This file
```

## Technologies Used

- **React 18** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server
- **CSS3** - Styling (no CSS framework)

## Browser Support

- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)
- Mobile browsers (iOS Safari, Chrome Mobile)

## Troubleshooting

### API Connection Issues

- Verify `VITE_API_BASE_URL` is correct
- Check CORS settings on n8n server
- Ensure n8n webhook is active and accessible

### Build Errors

- Clear `node_modules` and reinstall: `rm -rf node_modules && npm install`
- Check Node.js version: `node --version` (should be 18+)

### IIS Deployment Issues

- Ensure URL Rewrite module is installed
- Verify `web.config` exists in `dist` folder
- Check folder permissions for `IIS_IUSRS`

## Development Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build |
| `npm run lint` | Type check with TypeScript |

## License

Private - Internal ERP System Component

## Support

For issues or questions, contact your development team.

---

**Version:** 0.1.0  
**Last Updated:** January 2025
